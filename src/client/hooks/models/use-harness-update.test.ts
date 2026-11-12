/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The dialog's half of the background harness update.
 *
 * Four properties, and each one is a failure this design exists to prevent:
 * a `202` means the install is running in a WORKER (so the card must follow it);
 * a second harness pressed while the first installs is ACCEPTED and QUEUED (it
 * must be followed too, and its own settle reported); a `409` for the SAME
 * harness must come back as the refusal it is (no second install); and a run
 * already in flight must be ADOPTED when the card opens — otherwise a reload
 * loses the spinner and the user presses the button again.
 *
 * Every wait here is on the settle callback, not on a duration: the poll cadence
 * is handed in at 1ms, so a race shows up as a missing signal rather than as a
 * sleep that "usually" covers it.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { useHarnessUpdate } from '@/client/hooks/models/use-harness-update';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';
import type { HarnessUpdateJob } from '@/shared/types/harness-update';

const realFetch = Bun.fetch;
const TEST_POLL_MS = 1;
let container: HTMLElement;
let calls: string[] = [];
let postReplies: { status: number; body: unknown }[] = [];
let statusJobs: HarnessUpdateJob[] = [];
/** Called when the card re-reads the version rows (the probe-arrival signal). */
let onVersionsRead: (() => void) | null = null;
/** Called when the stub answers one status poll — the "a poll landed" signal. */
let onStatusRead: (() => void) | null = null;

function job(overrides: Partial<HarnessUpdateJob> = {}): HarnessUpdateJob {
  return {
    harness: 'claude',
    label: 'claude',
    startedAt: Date.now(),
    finishedAt: null,
    queuedAt: null,
    pid: 1234,
    steps: [{ part: 'adapter', command: 'npm install -g x', argv: ['npm', 'install', '-g', 'x'], state: 'running', code: null }],
    output: '',
    ok: null,
    message: null,
    applied: false,
    repointed: null,
    ...overrides,
  };
}

function finished(overrides: Partial<HarnessUpdateJob> = {}): HarnessUpdateJob {
  return job({ pid: null, finishedAt: Date.now(), ok: true, applied: true, ...overrides });
}

beforeEach(() => {
  installDomGlobals(new Window({ url: 'http://localhost' }));
  container = document.createElement('div');
  document.body.appendChild(container);
  calls = [];
  statusJobs = [];
  postReplies = [];
  onVersionsRead = null;
  onStatusRead = null;
  (globalThis as unknown as Record<string, unknown>).fetch = async (input: unknown, init?: { method?: string }) => {
    calls.push(`${init?.method ?? 'GET'} ${String(input)}`);
    if (init?.method === 'POST') {
      const reply = postReplies.length > 1 ? postReplies.shift()! : postReplies[0];
      return new Response(JSON.stringify(reply?.body ?? {}), { status: reply?.status ?? 202 });
    }
    if (init?.method === 'DELETE') {
      return new Response(JSON.stringify({ dismissed: true }), { status: 200 });
    }
    if (String(input).includes('/api/harness/versions')) {
      onVersionsRead?.();
      onVersionsRead = null;
      return new Response(JSON.stringify({ harnesses: [] }), { status: 200 });
    }
    const statusRead = onStatusRead;
    onStatusRead = null;
    statusRead?.();
    return new Response(JSON.stringify({ jobs: statusJobs }), { status: 200 });
  };
});

afterEach(() => {
  render(null, container);
  container.remove();
  restoreDomGlobals();
  (globalThis as unknown as Record<string, unknown>).fetch = realFetch;
});

interface Harness {
  current: () => ReturnType<typeof useHarnessUpdate>;
  /** The settled messages, in order. */
  settlements: Array<{ message: string; ok: boolean }>;
  /** Resolves when settlement number `index` has been reported. */
  settlement: (index: number) => Promise<{ message: string; ok: boolean }>;
}

function mount(): Harness {
  const settlements: Array<{ message: string; ok: boolean }> = [];
  const waiters: Array<() => void> = [];
  const box = { latest: null as ReturnType<typeof useHarnessUpdate> | null };
  function Consumer() {
    box.latest = useHarnessUpdate((message, ok) => {
      settlements.push({ message, ok });
      waiters.shift()?.();
    }, { pollMs: TEST_POLL_MS });
    return null;
  }
  const host = document.createElement('div');
  container.appendChild(host);
  act(() => render(h(Consumer, {}), host));
  return {
    current: () => {
      if (!box.latest) throw new Error('consumer did not render');
      return box.latest;
    },
    settlements,
    settlement: async (index) => {
      while (settlements.length <= index) {
        const { promise, resolve } = Promise.withResolvers<void>();
        waiters.push(resolve);
        await promise;
      }
      return settlements[index];
    },
  };
}

/** Let the mount's own status read settle. */
async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

const GETS = (): string[] => calls.filter((call) => call.startsWith('GET /api/harness/update/status'));

describe('useHarnessUpdate', () => {
  test('a 202 starts a run and the finished record settles it', async () => {
    const harness = mount();
    await flush();
    expect(harness.current().jobs).toEqual([]);

    postReplies = [{ status: 202, body: { started: true, queued: false, job: job() } }];
    // The worker is already done by the time the first status read lands: this
    // is the spinners-then-message path, with no real delay anywhere.
    statusJobs = [finished({ message: 'claude updated (adapter)' })];

    const started: { problem: string | null } = { problem: 'unset' };
    await act(async () => {
      started.problem = await harness.current().start('claude');
    });
    expect(started.problem).toBeNull();
    expect(await harness.settlement(0)).toEqual({ message: 'claude updated (adapter)', ok: true });
    // The record outlives the spinner: the log panel reads it AFTER the run, and
    // a cleared list would close the reader's only view of what was installed.
    expect(harness.current().jobs[0]?.message).toBe('claude updated (adapter)');
  });

  test('a second harness is ACCEPTED as queued, and both settles are reported', async () => {
    // The bug this fixes: pressing the second row while the first installed got
    // a 409 and nothing else. Both presses now return 202 — the second with a
    // `queued` record — and the queue starts it after the first settles.
    const harness = mount();
    await flush();

    postReplies = [
      { status: 202, body: { started: true, queued: false, job: job() } },
      { status: 202, body: { started: true, queued: true, job: job({ harness: 'codex', label: 'codex', pid: null, queuedAt: Date.now() }) } },
    ];
    statusJobs = [job(), job({ harness: 'codex', label: 'codex', pid: null, queuedAt: Date.now() })];

    let first: string | null = 'unset';
    let second: string | null = 'unset';
    await act(async () => {
      first = await harness.current().start('claude');
      second = await harness.current().start('codex');
    });
    expect(first).toBeNull();
    expect(second).toBeNull();
    expect(harness.current().jobs.map((entry) => entry.harness).sort()).toEqual(['claude', 'codex']);

    // Claude finishes, the queue starts codex, codex finishes.
    statusJobs = [
      finished({ message: 'claude updated (adapter)' }),
      job({ harness: 'codex', label: 'codex' }),
    ];
    expect(await harness.settlement(0)).toEqual({ message: 'claude updated (adapter)', ok: true });

    statusJobs = [
      finished({ message: 'claude updated (adapter)' }),
      finished({ harness: 'codex', label: 'codex', message: 'codex updated (codex-acp)' }),
    ];
    expect(await harness.settlement(1)).toEqual({ message: 'codex updated (codex-acp)', ok: true });
    // One settle each, not one per poll.
    expect(harness.settlements).toHaveLength(2);
  });

  test('a 409 comes back as the refusal, and its record is still readable', async () => {
    // The refusal carries the unfinished record (`job`), so the press that lost
    // the race can still open the log of the install it collided with.
    postReplies = [{
      status: 409,
      body: { error: 'claude update is already running — it continues in the background', job: job({ pid: 999 }) },
    }];
    const harness = mount();
    await flush();

    const refusal: { problem: string | null } = { problem: null };
    await act(async () => {
      refusal.problem = await harness.current().start('claude');
    });
    expect(refusal.problem).toContain('already running');
    expect(harness.current().jobs[0]?.pid).toBe(999);
    expect(harness.settlements).toEqual([]);
  });

  test('an in-flight run is adopted when the card opens', async () => {
    statusJobs = [job()];
    const harness = mount();
    await flush();
    // The spinner belongs to a run this page did not start — a second tab, or
    // this one after a reload.
    expect(harness.current().jobs[0]?.harness).toBe('claude');

    statusJobs = [finished({ ok: false, message: 'claude update failed (exit 1)' })];
    expect(await harness.settlement(0)).toEqual({ message: 'claude update failed (exit 1)', ok: false });
  });

  test('a settled run keeps polling until its PROBE answers, then re-reads the rows', async () => {
    // The row quotes the version the install just replaced until the server has
    // asked the new binary what it is. The poll is what carries that answer to
    // the row; without it, "updated" and a stale number sit side by side and the
    // only way out is pressing Check status.
    statusJobs = [finished({ message: 'claude updated (adapter)', probe: 'pending' })];
    const versionsRead = Promise.withResolvers<void>();
    onVersionsRead = versionsRead.resolve;
    const harness = mount();
    await flush();
    expect(harness.current().jobs[0]?.probe).toBe('pending');
    expect(harness.settlements).toEqual([]);

    // The probe answers on a later poll; the row's own read is the proof that it
    // arrived, and it is awaited rather than slept for.
    statusJobs = [finished({ message: 'claude updated (adapter) — it now reports 0.103.0', probe: 'done' })];
    await versionsRead.promise;
    expect(calls).toContain('GET /api/harness/versions');
    expect(harness.current().jobs[0]?.probe).toBe('done');
    // The probe arriving is not a second toast: one run, one report.
    expect(harness.settlements).toEqual([]);
  });

  test('a finished record on open is history, not a run to toast about', async () => {
    statusJobs = [finished({ message: 'claude updated (adapter)' })];
    const harness = mount();
    await flush();
    // The loop stopped after the ONE read: no unfinished record means nothing to
    // follow, so a finished record can never be reported as a fresh settle.
    expect(harness.settlements).toEqual([]);
    // No spinner, but the row can still offer the log of what ran.
    expect(harness.current().jobs[0]?.harness).toBe('claude');
    // One read and no follow-up: nothing is unfinished.
    expect(GETS()).toHaveLength(1);
  });

  test('"already up to date" is reported without following a job', async () => {
    postReplies = [{
      status: 200,
      body: { success: true, id: 'claude', message: 'claude is already up to date (adapter 0.102.0)' },
    }];
    const harness = mount();
    await flush();

    const current: { problem: string | null } = { problem: null };
    await act(async () => {
      current.problem = await harness.current().start('claude');
    });
    expect(current.problem).toBeNull();
    expect(harness.current().jobs).toEqual([]);
    expect(await harness.settlement(0)).toEqual({ message: 'claude is already up to date (adapter 0.102.0)', ok: true });
  });

  test('dismissing a settled result deletes the record and a stale poll cannot paint it back', async () => {
    // The defect: "claude updated (adapter) — it now reports 0.106.0" stayed on
    // the row with no way out. The delete is server-side (a closed card must not
    // resurrect it), and the RUN key is remembered so a poll that started before
    // the delete cannot re-add the record it still carries.
    statusJobs = [finished({ message: 'claude updated (adapter) — it now reports 0.106.0', probe: 'pending' })];
    const harness = mount();
    await flush();
    expect(harness.current().jobs).toHaveLength(1);

    await act(async () => {
      expect(await harness.current().dismiss('claude')).toBeNull();
    });
    expect(calls).toContain('DELETE /api/harness/update/status');
    expect(harness.current().jobs).toEqual([]);

    // A pending probe keeps the poll alive, and the stub keeps answering with
    // the record that was just deleted: the next poll landing must not restore it.
    const nextPoll = Promise.withResolvers<void>();
    onStatusRead = nextPoll.resolve;
    await act(async () => {
      await nextPoll.promise;
    });
    expect(harness.current().jobs).toEqual([]);
  });
});
