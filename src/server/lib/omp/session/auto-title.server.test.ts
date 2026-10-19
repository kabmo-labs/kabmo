/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, test } from 'bun:test';

import {
  consumeAutoTitleOutput,
  markTitleRequestSent,
  triggerAutoSessionTitle,
  type AutoTitleHost,
} from '@/server/lib/omp/session/auto-title.server';

/**
 * The safety property of auto-titling, and the one thing that must never
 * regress: Kabmo fires omp's own `/rename` (which persists through
 * `setSessionName(title, "user")`) in the background, and that write has no
 * "don't overwrite" guard of its own — omp only refuses an `"auto"` write over
 * a `"user"` title. So the decision to skip a NAMED session is ours, and a bug
 * here silently destroys a name the operator typed.
 *
 * These tests drive the guard directly: a fake `get_state` reports a name, and
 * the assertion is that no `/rename` reaches the wire.
 */

interface FakeProc {
  commands: Array<Record<string, unknown>>;
  sendCommand<T>(command: { type: string; [key: string]: unknown }): Promise<T>;
}

function makeHost(options: {
  sessionName?: string;
  sessionId?: string;
  inFlight?: boolean;
  pending?: boolean;
  requested?: boolean;
  windowUntil?: number;
  /** Called with the host the moment a `/rename` prompt reaches the wire, so a
   *  test can observe the window state the frame handler would see. */
  onPrompt?: (host: AutoTitleHost) => void;
  /** Make the `/rename` send reject, for the rollback path. */
  failPrompt?: boolean;
}): { host: AutoTitleHost; proc: FakeProc } {
  const host: AutoTitleHost = {
    sessionId: 'sess-1',
    autoTitleInFlight: options.inFlight ?? false,
    autoTitleWindowUntil: options.windowUntil ?? 0,
    autoTitlePending: options.pending ?? true,
    autoTitleRequested: options.requested ?? false,
    proc: undefined as unknown as AutoTitleHost['proc'],
  };
  const proc: FakeProc = {
    commands: [],
    async sendCommand<T>(command: { type: string; [key: string]: unknown }): Promise<T> {
      proc.commands.push(command);
      if (command.type === 'get_state') {
        return {
          sessionId: options.sessionId ?? 'sess-1',
          sessionName: options.sessionName,
        } as T;
      }
      options.onPrompt?.(host);
      if (options.failPrompt) throw new Error('send failed');
      return undefined as T;
    },
  };
  host.proc = proc as unknown as AutoTitleHost['proc'];
  return { host, proc };
}

/** Commands other than the `get_state` probe the guard always performs. */
function sentRenames(proc: FakeProc): Array<Record<string, unknown>> {
  return proc.commands.filter((command) => command.type === 'prompt');
}

describe('triggerAutoSessionTitle', () => {
  test('names an unnamed session through omp own /rename', async () => {
    const { host, proc } = makeHost({});
    await triggerAutoSessionTitle(host, 'opening');

    const renames = sentRenames(proc);
    expect(renames).toHaveLength(1);
    expect(renames[0].message).toBe('/rename');
    // The request window opens BEFORE the command is sent, so the
    // `prompt_result {agentInvoked:false}` omp answers within the same tick is
    // already attributable to us when it arrives.
    expect(host.autoTitleWindowUntil).toBeGreaterThan(Date.now());
  });

  test('the request window is armed BEFORE the /rename is sent', async () => {
    // The regression: omp answers the `/rename` prompt with
    // `prompt_result {agentInvoked:false}` in the same tick (measured 3 ms),
    // while the operator's turn is still streaming. The frame fold suppresses
    // that frame only while the window is armed — arming it after the ack left
    // the frame to reach the client, which settled the optimistic turn, blanked
    // the generating indicator and cleared the sidebar's live `stream` row
    // while the answer kept arriving (measured: indicator on for ~1.2 s of a
    // 20 s run).
    let windowAtSend = -1;
    const { host, proc } = makeHost({ onPrompt: (h) => { windowAtSend = h.autoTitleWindowUntil; } });
    await triggerAutoSessionTitle(host, 'opening');

    expect(sentRenames(proc)).toHaveLength(1);
    expect(windowAtSend).toBeGreaterThan(Date.now());
  });

  test('rolls the window back when the /rename never reached omp', async () => {
    // An armed window with no request behind it would swallow the next
    // operator frame inside its 60 s span — and block the settle-stage
    // fallback, which stands down while a generation is "in flight".
    const { host, proc } = makeHost({ failPrompt: true });
    await triggerAutoSessionTitle(host, 'opening');

    expect(sentRenames(proc)).toHaveLength(1);
    expect(host.autoTitleWindowUntil).toBe(0);
  });

  test('never overwrites a name the operator set', async () => {
    // At either stage: the name is re-read from omp, so a rename made in
    // another tab survives both the early attempt and the fallback.
    for (const stage of ['opening', 'settle'] as const) {
      const { host, proc } = makeHost({ sessionName: 'My Deliberate Name' });
      await triggerAutoSessionTitle(host, stage);

      expect(sentRenames(proc)).toHaveLength(0);
      // No request was sent, so nothing may claim the output window either.
      expect(host.autoTitleWindowUntil).toBe(0);
    }
  });

  test('treats a whitespace-only name as unnamed', async () => {
    const { host, proc } = makeHost({ sessionName: '   ' });
    await triggerAutoSessionTitle(host, 'opening');

    expect(sentRenames(proc)).toHaveLength(1);
  });

  test('skips when the session changed under the read', async () => {
    // `get_state` answered for a different conversation (a reset or switch
    // between the trigger and the read) — titling this session would name the
    // wrong one.
    const { host, proc } = makeHost({ sessionId: 'someone-else' });
    await triggerAutoSessionTitle(host, 'opening');

    expect(sentRenames(proc)).toHaveLength(0);
  });

  test('does not stack a second request while one is in flight', async () => {
    const { host, proc } = makeHost({ inFlight: true });
    await triggerAutoSessionTitle(host, 'opening');

    expect(sentRenames(proc)).toHaveLength(0);
    expect(proc.commands).toHaveLength(0);
  });

  test('the early attempt does not consume the eligibility latch', async () => {
    // The fallback exists precisely because the early attempt can come back
    // empty. If `opening` consumed the latch, a provider error at the first
    // user message would leave the session unnamed for good.
    const { host } = makeHost({});
    await triggerAutoSessionTitle(host, 'opening');

    expect(host.autoTitlePending).toBe(true);
    expect(host.autoTitleRequested).toBe(true);
  });

  test('the fallback retries once the early attempt came back empty', async () => {
    // The real sequence: the early `/rename` is accepted, omp answers
    // `command_output` (consuming the window) with no title, and the run then
    // ends — the fallback is what names the session.
    const { host, proc } = makeHost({});
    await triggerAutoSessionTitle(host, 'opening');
    expect(consumeAutoTitleOutput(host)).toBe(true);

    await triggerAutoSessionTitle(host, 'settle');

    expect(sentRenames(proc)).toHaveLength(2);
    expect(host.autoTitlePending).toBe(false);
  });

  test('the fallback stands down while the early generation is in flight', async () => {
    // A short run can end before the tiny model answers (~4s). Re-asking there
    // would reserve a new title revision and cancel the generation already in
    // flight, for a title derived from the same opening turn.
    const { host, proc } = makeHost({});
    await triggerAutoSessionTitle(host, 'opening');
    expect(host.autoTitleWindowUntil).toBeGreaterThan(Date.now());

    await triggerAutoSessionTitle(host, 'settle');

    expect(sentRenames(proc)).toHaveLength(1);
    // The latch is still consumed: the attempt in flight owns this
    // conversation's title from here.
    expect(host.autoTitlePending).toBe(false);
  });

  test('fires the early attempt once per run', async () => {
    // A queued steer message also settles as a user message inside the same
    // run; re-asking on it would cancel the first generation for no gain.
    const { host, proc } = makeHost({});
    await triggerAutoSessionTitle(host, 'opening');
    await triggerAutoSessionTitle(host, 'opening');

    expect(sentRenames(proc)).toHaveLength(1);
  });

  test('titles from the first run only', async () => {
    // The regression this latch exists for: a second turn used to fire its own
    // `/rename`, and omp derives that title from the NEWEST turns — so the
    // session ended up named after message two.
    const { host, proc } = makeHost({});
    await triggerAutoSessionTitle(host, 'opening');
    await triggerAutoSessionTitle(host, 'settle');
    expect(sentRenames(proc)).toHaveLength(1);

    // A later run reaches neither stage with the latch consumed.
    await triggerAutoSessionTitle(host, 'opening');
    await triggerAutoSessionTitle(host, 'settle');

    expect(sentRenames(proc)).toHaveLength(1);
  });

  test('skips a conversation that already has a first turn behind it', async () => {
    // A child resumed for an existing session (`--resume` after the idle
    // reclaim) reports a non-zero message count, so its next turn must not
    // name it — the session is either titled already or deliberately unnamed.
    const { host, proc } = makeHost({ pending: false });
    await triggerAutoSessionTitle(host, 'opening');
    await triggerAutoSessionTitle(host, 'settle');

    expect(sentRenames(proc)).toHaveLength(0);
    expect(host.autoTitleWindowUntil).toBe(0);
  });

  test('consumes the latch even when generation is skipped', async () => {
    // A declined generation must not leave the door open for the next turn:
    // otherwise a first turn whose title the provider refused gets re-asked
    // after every later message, which is the same bug one step later.
    const { host } = makeHost({});
    await triggerAutoSessionTitle(host, 'settle');

    expect(host.autoTitlePending).toBe(false);
  });
});

describe('auto-title output window', () => {
  test('claims exactly one frame per request', () => {
    const { host } = makeHost({});
    markTitleRequestSent(host);

    expect(consumeAutoTitleOutput(host)).toBe(true);
    // omp emits a single command_output per /rename; a second frame inside the
    // window belongs to something the operator typed and must reach the UI.
    expect(consumeAutoTitleOutput(host)).toBe(false);
  });

  test('claims nothing when no request is outstanding', () => {
    const { host } = makeHost({});
    expect(consumeAutoTitleOutput(host)).toBe(false);
  });

  test('expires so a stale window cannot swallow an operator command', () => {
    const { host } = makeHost({});
    markTitleRequestSent(host);
    host.autoTitleWindowUntil = Date.now() - 1;

    expect(consumeAutoTitleOutput(host)).toBe(false);
  });
});
