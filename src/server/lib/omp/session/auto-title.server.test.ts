/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Auto-titling's two properties that must never regress.
 *
 * 1. **It never overwrites a name the operator set.** Kabmo fires omp's own
 *    `/rename` (which persists through `setSessionName(title, "user")`) in the
 *    background, and that write has no "don't overwrite" guard of its own — omp
 *    only refuses an `"auto"` write over a `"user"` title. The decision to skip
 *    a NAMED session is ours, and a bug here silently destroys a name the
 *    operator typed.
 *
 * 2. **The run end ALWAYS asks, and it asks on the session's own model.** Both
 *    halves were broken on a real install and neither was visible from Kabmo's
 *    side: the fallback stood down while an early generation was "in flight"
 *    (it had in fact already failed 52 s earlier), and the request ran on omp's
 *    configured `tiny` role — `kenari/deepseek-v4-flash` here, whose plan had
 *    lapsed — so every attempt answered `429 plan_limit_reached` and no session
 *    was ever named. Six measured attempts, four unnamed sessions.
 *
 * The fake `get_state` and the recorded command list are the whole surface: no
 * omp child, no database, no wall-clock waiting.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  awaitTitleDispatch,
  consumeAutoTitleOutput,
  markTitleRequestSent,
  triggerAutoSessionTitle,
  type AutoTitleHost,
} from '@/server/lib/omp/session/auto-title.server';
import { titleModelOverlayPath } from '@/server/lib/omp/session/title-model-overlay.server';

/**
 * The model pin is a FILE under the agent dir, so the suite points that dir at
 * a temp tree: nothing here may touch the developer's own `~/.omp`.
 */
let agentDir: string;
let previousAgentDir: string | undefined;

beforeAll(() => {
  agentDir = mkdtempSync(join(tmpdir(), 'kabmo-auto-title-'));
  previousAgentDir = Bun.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
});

afterAll(() => {
  if (previousAgentDir === undefined) delete Bun.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  rmSync(agentDir, { recursive: true, force: true });
});

interface FakeProc {
  commands: Array<Record<string, unknown>>;
  sendCommand<T>(command: { type: string; [key: string]: unknown }): Promise<T>;
}

/** Hosts built by the current test. The model pin is ONE file (newest wins), so
 *  a request left unanswered would keep it pinned for every later test — the
 *  drain below is what makes each case independent. */
const created: AutoTitleHost[] = [];

afterEach(async () => {
  for (const host of created.splice(0)) {
    while (host.autoTitleClaims > 0) consumeAutoTitleOutput(host);
  }
  // Let the pin's `finally` (an atomic file replace) run.
  for (let i = 0; i < 16; i += 1) await Promise.resolve();
});

function makeHost(options: {
  sessionName?: string;
  sessionId?: string;
  pending?: boolean;
  requested?: boolean;
  claims?: number;
  windowUntil?: number;
  model?: { provider: string; modelId: string } | null;
  /** Called the moment a `/rename` prompt reaches the wire. */
  onPrompt?: (host: AutoTitleHost) => void;
  /** Make the `/rename` send reject, for the rollback path. */
  failPrompt?: boolean;
  /** Suppress the frame that answers a `/rename`, so its claim stays open. */
  unanswered?: boolean;
}): { host: AutoTitleHost; proc: FakeProc } {
  const host: AutoTitleHost = {
    sessionId: 'sess-1',
    autoTitleWindowUntil: options.windowUntil ?? 0,
    autoTitleClaims: options.claims ?? 0,
    autoTitleDispatch: null,
    autoTitlePending: options.pending ?? true,
    autoTitleRequested: options.requested ?? false,
    autoTitleModel: options.model ?? { provider: 'kenari-jatis', modelId: 'deepseek-v4-1-flash' },
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
      // The generation is reported by frames the fold delivers; a test that
      // wants the claim consumed drives `consumeAutoTitleOutput` itself.
      if (!options.unanswered) consumeAutoTitleOutput(host);
      return undefined as T;
    },
  };
  host.proc = proc as unknown as AutoTitleHost['proc'];
  created.push(host);
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
  });

  test('the request claim is armed BEFORE the /rename is sent', async () => {
    // omp answers the `/rename` prompt with `prompt_result {agentInvoked:false}`
    // in the same tick (measured 3 ms) while the operator's turn still streams.
    // The fold suppresses that frame only while a claim is armed.
    let claimsAtSend = -1;
    const { host, proc } = makeHost({
      unanswered: true,
      onPrompt: (h) => {
        claimsAtSend = h.autoTitleClaims;
      },
    });
    void triggerAutoSessionTitle(host, 'opening');
    await awaitTitleDispatch(host);

    expect(sentRenames(proc)).toHaveLength(1);
    expect(claimsAtSend).toBe(1);
  });

  test('rolls the claim back when the /rename never reached omp', async () => {
    const { host, proc } = makeHost({ failPrompt: true });
    await triggerAutoSessionTitle(host, 'opening');

    expect(sentRenames(proc)).toHaveLength(1);
    expect(host.autoTitleClaims).toBe(0);
    expect(host.autoTitleWindowUntil).toBe(0);
  });

  test('never overwrites a name the operator set', async () => {
    for (const stage of ['opening', 'settle'] as const) {
      const { host, proc } = makeHost({ sessionName: 'My Deliberate Name' });
      await triggerAutoSessionTitle(host, stage);

      expect(sentRenames(proc)).toHaveLength(0);
      expect(host.autoTitleClaims).toBe(0);
    }
  });

  test('treats a whitespace-only name as unnamed', async () => {
    const { host, proc } = makeHost({ sessionName: '   ' });
    await triggerAutoSessionTitle(host, 'opening');

    expect(sentRenames(proc)).toHaveLength(1);
  });

  test('skips when the session changed under the read', async () => {
    const { host, proc } = makeHost({ sessionId: 'someone-else' });
    await triggerAutoSessionTitle(host, 'opening');

    expect(sentRenames(proc)).toHaveLength(0);
  });

  test('the early attempt does not consume the eligibility latch', async () => {
    const { host } = makeHost({});
    await triggerAutoSessionTitle(host, 'opening');

    expect(host.autoTitlePending).toBe(true);
    expect(host.autoTitleRequested).toBe(true);
  });

  test('the run end ALWAYS asks, even while an early attempt is unanswered', async () => {
    // The shipped defect: the fallback stood down while the early generation's
    // window was still armed, on the assumption that generation would land. On
    // a real session it had already failed ~52 s earlier, so the run ended with
    // nothing asked again and the session kept its placeholder forever.
    const { host, proc } = makeHost({ unanswered: true });
    void triggerAutoSessionTitle(host, 'opening');
    await awaitTitleDispatch(host);
    expect(sentRenames(proc)).toHaveLength(1);
    expect(host.autoTitleClaims).toBe(1);

    void triggerAutoSessionTitle(host, 'settle');
    await awaitTitleDispatch(host);

    expect(sentRenames(proc)).toHaveLength(2);
    // Consumed: this conversation's last chance has been taken.
    expect(host.autoTitlePending).toBe(false);
  });

  test('the fallback is dispatched only after the early attempt acknowledged', async () => {
    // Two frames on one stdin: omp cancels a superseded rename and emits no
    // frame for it, so the two dispatches must not race.
    const order: string[] = [];
    const { host } = makeHost({
      unanswered: true,
      onPrompt: () => order.push(`send:${order.length}`),
    });
    void triggerAutoSessionTitle(host, 'opening');
    await awaitTitleDispatch(host);
    void triggerAutoSessionTitle(host, 'settle');
    await awaitTitleDispatch(host);

    expect(order).toHaveLength(2);
    // Both were dispatched, and the second only after the first resolved its
    // ack — the chain is what guarantees the ordering.
    expect(host.autoTitleClaims).toBe(2);
  });

  test('fires the early attempt once per run', async () => {
    const { host, proc } = makeHost({});
    await triggerAutoSessionTitle(host, 'opening');
    await triggerAutoSessionTitle(host, 'opening');

    expect(sentRenames(proc)).toHaveLength(1);
  });

  test('titles from the first run only', async () => {
    const { host, proc } = makeHost({});
    await triggerAutoSessionTitle(host, 'opening');
    await triggerAutoSessionTitle(host, 'settle');
    expect(sentRenames(proc)).toHaveLength(2);

    await triggerAutoSessionTitle(host, 'opening');
    await triggerAutoSessionTitle(host, 'settle');

    expect(sentRenames(proc)).toHaveLength(2);
  });

  test('skips a conversation that already has a first turn behind it', async () => {
    const { host, proc } = makeHost({ pending: false });
    await triggerAutoSessionTitle(host, 'opening');
    await triggerAutoSessionTitle(host, 'settle');

    expect(sentRenames(proc)).toHaveLength(0);
    expect(host.autoTitleClaims).toBe(0);
  });

  test('consumes the latch even when generation is skipped', async () => {
    const { host } = makeHost({});
    await triggerAutoSessionTitle(host, 'settle');

    expect(host.autoTitlePending).toBe(false);
  });

  test('runs the request on the SESSION model, not omp tiny role', async () => {
    // The regression: every attempt ran on omp's configured `tiny` role, whose
    // plan had lapsed, so the generation answered 429 and no session was ever
    // named. The pin is a file omp watches, so its content at send time is the
    // observable proof of which role the request runs under.
    let pinned = '';
    const { host } = makeHost({
      unanswered: true,
      onPrompt: () => {
        pinned = readFileSync(titleModelOverlayPath(), 'utf8');
      },
    });
    void triggerAutoSessionTitle(host, 'opening');
    await awaitTitleDispatch(host);

    expect(pinned).toContain('tiny: "kenari-jatis/deepseek-v4-1-flash"');
  });

  test('releases the pin once the request has answered', async () => {
    const { host } = makeHost({});
    await triggerAutoSessionTitle(host, 'opening');

    // Restored to the no-op overlay, so the next child that loads it is not
    // pinned to a session's model.
    expect(readFileSync(titleModelOverlayPath(), 'utf8')).toBe('{}\n');
  });
});

describe('auto-title output window', () => {
  test('claims exactly one frame per request', () => {
    const { host } = makeHost({});
    markTitleRequestSent(host);

    expect(consumeAutoTitleOutput(host)).toBe(true);
    expect(consumeAutoTitleOutput(host)).toBe(false);
  });

  test('claims nothing when no request is outstanding', () => {
    const { host } = makeHost({});
    expect(consumeAutoTitleOutput(host)).toBe(false);
  });

  test('expires so a stale claim cannot swallow an operator command', () => {
    const { host } = makeHost({});
    markTitleRequestSent(host);
    host.autoTitleWindowUntil = Date.now() - 1;

    expect(consumeAutoTitleOutput(host)).toBe(false);
  });
});
