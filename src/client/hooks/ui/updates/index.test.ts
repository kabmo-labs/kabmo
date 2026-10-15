/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The console's half of an OMPChamber update that restarts its own server.
 *
 * The route arms a detached restart and answers first, so the page is still
 * served by the process whose build was just replaced. Reloading on the result
 * frame fetches the OLD bundle back; never reloading leaves the user on a stale
 * page. These mounts pin the pair: an armed restart waits for the replacement
 * and then reloads, and every other outcome still just re-checks.
 *
 * Mounted with a stubbed `fetch` (by URL) and a stubbed `window.location`, so
 * the assertions are the two observable effects — the reload and the re-check.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';

import { isUpdateApplyResult, useUpdates, type UseUpdatesResult } from '@/client/hooks/ui/updates';
import type { RestartWatchDeps } from '@/client/hooks/ui/updates/restart';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';

let win: Window;
let container: HTMLElement;
/** The injected clock the timeout case advances. */
let clock = 0;

/** One SSE frame, as the route writes it. */
function sseFrame(event: string, payload: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
}

/** A response whose body is the given frames, already complete. */
function sseResponse(frames: string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const frame of frames) controller.enqueue(encoder.encode(frame));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

/** A check payload with an OMPChamber update available. */
function checkPayload(): Record<string, unknown> {
  return {
    ompchamber: { current: '1.0.0', latest: '2.0.0', updateAvailable: true, installed: true, error: null },
    omp: { current: null, latest: null, updateAvailable: false, installed: false, error: null },
    checkedAt: '2026-10-15T00:00:00.000Z',
  };
}

interface Harness {
  /** The hook's latest result, replaced on every render. */
  readonly updates: UseUpdatesResult;
  readonly reloads: number;
  readonly requests: string[];
}

/** No real waiting: the loop is under test, not the clock. */
const noSleep = async (): Promise<void> => {};

/** The default when a test does not override the watch's clock. */
const NO_RESTART_DEPS: RestartWatchDeps = {};

/** Mount the hook and expose its result plus the reload/request observations. */
async function mount(
  handler: (url: string) => Response,
  healthIdentity: () => Record<string, unknown>,
  restart: RestartWatchDeps = NO_RESTART_DEPS,
): Promise<Harness> {
  const requests: string[] = [];
  const observed = { updates: null as UseUpdatesResult | null, reloads: 0 };

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    requests.push(url);
    if (url.includes('/api/health')) return Response.json(healthIdentity());
    return handler(url);
  }) as unknown as typeof fetch;

  win.location.reload = () => {
    observed.reloads += 1;
  };

  function Probe() {
    observed.updates = useUpdates({ restart });
    return null;
  }

  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    render(h(Probe, {}), container);
  });
  // The mount's own automatic check must settle before a test starts counting.
  await act(async () => {});

  return {
    get updates() {
      const current = observed.updates;
      if (!current) throw new Error('hook did not mount');
      return current;
    },
    get reloads() {
      return observed.reloads;
    },
    requests,
  };
}

beforeAll(() => {
  win = new Window({ url: 'http://localhost' });
  installDomGlobals(win);
});

afterEach(() => {
  if (container) render(null, container);
  container?.remove();
});

afterAll(() => {
  restoreDomGlobals();
});

describe('an update that restarts its own server', () => {
  test('waits for the replacement, then reloads the page', async () => {
    let probe = 0;
    const harness = await mount(
      (url) => {
        if (url.includes('/api/updates/check')) return Response.json(checkPayload());
        return sseResponse([
          sseFrame('stage', 'Installing ompchamber@2.0.0'),
          sseFrame('result', {
            success: true,
            target: 'ompchamber',
            manual: false,
            message: 'OMPChamber updated to v2.0.0 (bun-global). Restarting on port 4242 to apply it — this page reloads on its own.',
            restarting: true,
          }),
        ]);
      },
      // The baseline is the process serving the page; the next probe is the
      // replacement, which is what the wait is looking for.
      () => {
        probe += 1;
        return probe === 1
          ? { pid: 100, startedAt: '2026-10-15T00:00:00.000Z', uptime: 900 }
          : { pid: 200, startedAt: '2026-10-15T01:00:00.000Z', uptime: 0.3 };
      },
      { sleep: noSleep },
    );

    let result: unknown = null;
    await act(async () => {
      result = await harness.updates.apply('ompchamber');
    });

    expect(harness.reloads).toBe(1);
    // The reload happens INSTEAD of a re-check: asking the process that is
    // exiting for its version would read the old one back.
    expect(harness.requests.filter((url) => url.includes('/api/updates/check')).length).toBe(1);
    if (!isUpdateApplyResult(result)) throw new Error('expected an apply result');
    expect(result.restarting).toBe(true);
  });

  test('a replacement that never comes up is reported, not waited on forever', async () => {
    const harness = await mount(
      (url) => {
        if (url.includes('/api/updates/check')) return Response.json(checkPayload());
        return sseResponse([
          sseFrame('result', { success: true, target: 'ompchamber', manual: false, message: 'OMPChamber updated to v2.0.0 (bun-global).', restarting: true }),
        ]);
      },
      // The same process keeps answering: the port never went down.
      () => ({ pid: 100, startedAt: '2026-10-15T00:00:00.000Z', uptime: 900 }),
      // A clock that jumps past the deadline on the first pass — the same path
      // a real 30 s wait takes, with no waiting.
      { sleep: noSleep, now: () => (clock += 60_000) },
    );

    let result: unknown = null;
    await act(async () => {
      result = await harness.updates.apply('ompchamber');
    });

    expect(harness.reloads).toBe(0);
    if (!isUpdateApplyResult(result)) throw new Error('expected an apply result');
    expect(result.restarting).toBe(false);
    expect(result.message).toContain('did not come back');
  });
});

describe('an update that does not restart', () => {
  test('re-checks instead of reloading', async () => {
    const harness = await mount(
      (url) => {
        if (url.includes('/api/updates/check')) return Response.json(checkPayload());
        return sseResponse([sseFrame('result', { success: true, target: 'omp', manual: false, message: 'oh-my-pi updated' })]);
      },
      () => ({ pid: 100, startedAt: '2026-10-15T00:00:00.000Z', uptime: 900 }),
    );

    await act(async () => {
      await harness.updates.apply('omp');
    });

    expect(harness.reloads).toBe(0);
    // The mount's check plus this one.
    expect(harness.requests.filter((url) => url.includes('/api/updates/check')).length).toBe(2);
  });
});
