/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The console's "Restart Kabmo" action.
 *
 * Three outcomes have to be told apart, and each was a way to get this wrong:
 * an ARMED restart must wait for a process with a different identity and then
 * reload (reloading on the response would fetch the dying process's bundle
 * back); a REFUSAL (`restarting: false`) must surface the server's own
 * sentence instead of reloading; and a replacement that never answers must be
 * reported rather than waited on forever.
 *
 * Mounted with a stubbed `fetch` (by URL) and a stubbed `window.location`, so
 * the assertions are the two observable effects — the reload and the message.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';

import { useRestartChamber, type UseRestartChamberResult } from '@/client/hooks/settings/restart-chamber';
import type { RestartWatchDeps } from '@/client/hooks/ui/updates/restart';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';

let win: Window;
let container: HTMLElement;

/** No real waiting: the loop is under test, not the clock. */
const noSleep = async (): Promise<void> => {};

interface Harness {
  readonly restart: UseRestartChamberResult;
  readonly reloads: number;
  readonly requests: string[];
}

async function mount(
  handler: (url: string) => Response,
  healthIdentity: () => Record<string, unknown>,
  restart: RestartWatchDeps = {},
): Promise<Harness> {
  const requests: string[] = [];
  const observed = { hook: null as UseRestartChamberResult | null, reloads: 0 };

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
    observed.hook = useRestartChamber({ restart });
    return null;
  }

  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    render(h(Probe, {}), container);
  });

  return {
    get restart() {
      const current = observed.hook;
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

const ARMED = { success: true, restarting: true, message: 'Restarting on port 4242 — this page reloads on its own.' };

describe('restarting Kabmo from the console', () => {
  test('waits for the replacement, then reloads the page', async () => {
    let probe = 0;
    const harness = await mount(
      () => Response.json(ARMED),
      () => {
        probe += 1;
        return probe === 1
          ? { pid: 100, startedAt: '2026-10-15T00:00:00.000Z', uptime: 900 }
          : { pid: 200, startedAt: '2026-10-15T01:00:00.000Z', uptime: 0.3 };
      },
      { sleep: noSleep },
    );

    let outcome: unknown = null;
    await act(async () => {
      outcome = await harness.restart.restart();
    });

    expect(harness.reloads).toBe(1);
    expect(harness.requests).toContain('/api/chamber/restart');
    expect(outcome).toEqual({ ok: true, message: ARMED.message });
  });

  test('a refusal reports the server reason and reloads nothing', async () => {
    const harness = await mount(
      () => Response.json({
        success: true,
        restarting: false,
        message: 'this instance runs from source (`bun run dev` / `bun run start`) — start it again',
      }),
      () => ({ pid: 100, startedAt: '2026-10-15T00:00:00.000Z', uptime: 900 }),
      { sleep: noSleep },
    );

    let outcome: unknown = null;
    await act(async () => {
      outcome = await harness.restart.restart();
    });

    expect(harness.reloads).toBe(0);
    expect(outcome).toEqual({
      ok: false,
      message: 'this instance runs from source (`bun run dev` / `bun run start`) — start it again',
    });
  });

  test('a replacement that never comes up is reported, not waited on forever', async () => {
    let clock = 0;
    const harness = await mount(
      () => Response.json(ARMED),
      // The same process keeps answering: the port never went down.
      () => ({ pid: 100, startedAt: '2026-10-15T00:00:00.000Z', uptime: 900 }),
      // A clock that jumps past the deadline on the first pass — the same path
      // a real 30 s wait takes, with no waiting.
      { sleep: noSleep, now: () => (clock += 60_000) },
    );

    // A holder rather than a bare `let`: the value is assigned inside the act
    // callback, which control-flow analysis cannot see, so a narrowed `null`
    // would be read back here.
    const observed: { outcome: { ok: boolean; message: string } | null } = { outcome: null };
    await act(async () => {
      observed.outcome = await harness.restart.restart();
    });

    expect(harness.reloads).toBe(0);
    const outcome = observed.outcome;
    if (!outcome) throw new Error('expected an outcome');
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain('did not come back');
  });

  test('a failed request surfaces the server error, not a generic one', async () => {
    const harness = await mount(
      () => Response.json({ error: 'Restart is unavailable in mock mode.' }, { status: 409 }),
      () => ({ pid: 100, startedAt: '2026-10-15T00:00:00.000Z', uptime: 900 }),
    );

    let outcome: unknown = null;
    await act(async () => {
      outcome = await harness.restart.restart();
    });

    expect(harness.reloads).toBe(0);
    expect(outcome).toEqual({ ok: false, message: 'Restart is unavailable in mock mode.' });
  });
});
