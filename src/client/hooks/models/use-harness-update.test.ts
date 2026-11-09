/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The dialog's half of the background harness update.
 *
 * Three properties, and each one is a failure this design exists to prevent:
 * a `202` means the install is running in a WORKER (so the card must follow it),
 * a `409` must come back as the refusal it is (no second install), and a run
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
let postPayload: { status: number; body: unknown } = { status: 202, body: {} };
let statusPayload: HarnessUpdateJob | null = null;

function job(overrides: Partial<HarnessUpdateJob> = {}): HarnessUpdateJob {
  return {
    harness: 'claude',
    label: 'claude',
    startedAt: Date.now(),
    finishedAt: null,
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

beforeEach(() => {
  installDomGlobals(new Window({ url: 'http://localhost' }));
  container = document.createElement('div');
  document.body.appendChild(container);
  calls = [];
  statusPayload = null;
  postPayload = { status: 202, body: {} };
  (globalThis as unknown as Record<string, unknown>).fetch = async (input: unknown, init?: { method?: string }) => {
    calls.push(`${init?.method ?? 'GET'} ${String(input)}`);
    if (init?.method === 'POST') {
      return new Response(JSON.stringify(postPayload.body), { status: postPayload.status });
    }
    return new Response(JSON.stringify({ job: statusPayload }), { status: 200 });
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
  /** Resolves with what the card was told when the run settled. */
  settled: Promise<{ message: string; ok: boolean }>;
}

function mount(): Harness {
  const { promise, resolve } = Promise.withResolvers<{ message: string; ok: boolean }>();
  const box = { latest: null as ReturnType<typeof useHarnessUpdate> | null };
  function Consumer() {
    box.latest = useHarnessUpdate((message, ok) => resolve({ message, ok }), { pollMs: TEST_POLL_MS });
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
    settled: promise,
  };
}

/** Let the mount's own status read settle. */
async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('useHarnessUpdate', () => {
  test('a 202 starts a run and the finished record settles it', async () => {
    const harness = mount();
    await flush();
    expect(harness.current().updating).toBeNull();

    postPayload = { status: 202, body: { started: true, job: job() } };
    // The worker is already done by the time the first status read lands: this
    // is the spinners-then-message path, with no real delay anywhere.
    statusPayload = job({ finishedAt: Date.now(), pid: null, ok: true, applied: true, message: 'claude updated (adapter)' });

    const started: { problem: string | null } = { problem: 'unset' };
    await act(async () => {
      started.problem = await harness.current().start('claude');
    });
    expect(started.problem).toBeNull();
    // The spinner's own state is pinned by the adoption case below; here the
    // record was already finished, so the run settles inside the same flush.
    expect(await harness.settled).toEqual({ message: 'claude updated (adapter)', ok: true });
    expect(harness.current().updating).toBeNull();
    // The record outlives the spinner: the log panel reads it AFTER the run, and
    // a cleared `job` would close the reader's only view of what was installed.
    expect(harness.current().job?.message).toBe('claude updated (adapter)');
  });

  test('a 409 comes back as the refusal, and its record is still readable', async () => {
    // The refusal carries the RUNNING record (`job`), so the press that lost the
    // race can still open the log of the install it collided with.
    postPayload = {
      status: 409,
      body: { error: 'claude update is already running — it continues in the background', job: job({ pid: 999 }) },
    };
    const harness = mount();
    await flush();

    const refusal: { problem: string | null } = { problem: null };
    await act(async () => {
      refusal.problem = await harness.current().start('claude');
    });
    expect(refusal.problem).toContain('already running');
    expect(harness.current().updating).toBeNull();
    expect(harness.current().job?.pid).toBe(999);
  });

  test('an in-flight run is adopted when the card opens', async () => {
    statusPayload = job();
    const harness = mount();
    await flush();
    // The spinner belongs to a run this page did not start — a second tab, or
    // this one after a reload.
    expect(harness.current().updating).toBe('claude');

    statusPayload = job({ finishedAt: Date.now(), pid: null, ok: false, applied: true, message: 'claude update failed (exit 1)' });
    expect(await harness.settled).toEqual({ message: 'claude update failed (exit 1)', ok: false });
  });

  test('a finished record on open is history, not a run to follow', async () => {
    statusPayload = job({ finishedAt: Date.now(), pid: null, ok: true, applied: true, message: 'claude updated (adapter)' });
    const harness = mount();
    await flush();
    expect(harness.current().updating).toBeNull();
    // No spinner, but the row can still offer the log of what ran.
    expect(harness.current().job?.harness).toBe('claude');
  });

  test('"already up to date" is reported without following a job', async () => {
    postPayload = {
      status: 200,
      body: { success: true, id: 'claude', message: 'claude is already up to date (adapter 0.102.0)' },
    };
    const harness = mount();
    await flush();

    const current: { problem: string | null } = { problem: null };
    await act(async () => {
      current.problem = await harness.current().start('claude');
    });
    expect(current.problem).toBeNull();
    expect(harness.current().updating).toBeNull();
    // Nothing ran, so there is no record for a row to show a log of.
    expect(harness.current().job).toBeNull();
    expect(await harness.settled).toEqual({ message: 'claude is already up to date (adapter 0.102.0)', ok: true });
    // One read — the mount's — and no poll for a job that does not exist.
    expect(calls.filter((call) => call.startsWith('GET /api/harness/update/status'))).toHaveLength(1);
  });
});
