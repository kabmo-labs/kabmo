/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The goal driver: what Kabmo does after every finished turn.
 *
 * The rules worth pinning are the ones a naive loop gets wrong — a single
 * "blocked" verdict must NOT end a goal (three in a row do), a check that could
 * not run must not drive the loop blind to the ceiling, and a goal whose loop
 * already stood down must stay down until the operator resumes it.
 *
 * The auditor and the goal context are injected: this suite must not spawn omp
 * or read session files (same reason `runScheduledTask` takes its deps).
 */

import { describe, expect, test } from 'bun:test';
import {
  driveGoalAfterTurn,
  lastAssistantText,
  resetGoalDriverState,
  type GoalDriverContext,
  type GoalDriverDeps,
} from '@/server/lib/omp/session/goal-driver.server';
import type { GoalAuditAnswers } from '@/server/lib/omp/session/goal-auditor.server';
import type { GoalRecord } from '@/shared/lib/omp/mode/types';

const goal: GoalRecord = {
  id: 'g1',
  objective: 'Ship the exporter',
  status: 'active',
  tokensUsed: 10,
  timeUsedSeconds: 3,
  createdAt: 0,
  updatedAt: 0,
};

const SAY = (allDone: boolean, remaining: boolean, needsUser: boolean): GoalAuditAnswers => ({
  allDone,
  remaining,
  needsUser,
});

interface Harness {
  sent: string[];
  events: Array<Record<string, unknown>>;
  deps: GoalDriverDeps;
  run: () => Promise<void>;
}

function harness(options: {
  answers?: GoalAuditAnswers | null | Array<GoalAuditAnswers | null>;
  context?: GoalDriverContext | null;
  messages?: unknown;
  sessionId?: string;
  /** The loop's own settings; the auditor is ON unless a test says otherwise. */
  auditEnabled?: boolean;
  auditModel?: string;
  /** Observe each audit request (model selection). */
  onAudit?: (request: { model?: string; objective: string; answer: string }) => void;
} = {}): Harness {
  const sent: string[] = [];
  const events: Array<Record<string, unknown>> = [];
  const sessionId = options.sessionId ?? `s-${Math.random().toString(36).slice(2)}`;
  resetGoalDriverState(sessionId);
  const answers = Array.isArray(options.answers) ? options.answers : [options.answers ?? SAY(false, true, false)];
  let call = 0;
  const deps: GoalDriverDeps = {
    audit: async (request) => {
      options.onAudit?.(request);
      return answers[Math.min(call++, answers.length - 1)] ?? null;
    },
    context: async () => (options.context === undefined ? { goal, continuationStop: undefined } : options.context),
    model: async () => 'test/model',
    settings: async () => ({ auditEnabled: options.auditEnabled !== false, auditModel: options.auditModel ?? '' }),
  };
  const host = {
    sessionId,
    cwd: '/tmp',
    send: async (command: Record<string, unknown>) => {
      sent.push(String(command.message));
      return null;
    },
    emit: (event: Record<string, unknown>) => {
      events.push(event);
    },
  };
  return {
    sent,
    events,
    deps,
    run: () =>
      driveGoalAfterTurn({
        host,
        messages: options.messages ?? [{ role: 'assistant', content: [{ type: 'text', text: 'done and verified' }] }],
        deps,
      }),
  };
}

describe('driveGoalAfterTurn', () => {
  test('asks the auditor and continues when it says keep going', async () => {
    const h = harness({ answers: SAY(false, true, false) });
    await h.run();

    expect(h.sent).toEqual(['/kabmo-mode goal continue']);
    // The spinner's window is exactly the audit: on before, off after.
    expect(h.events.map((e) => e.evaluating)).toEqual([true, false]);
  });

  test('a complete verdict closes the loop', async () => {
    const h = harness({ answers: SAY(true, false, false) });
    await h.run();
    expect(h.sent).toEqual([`/kabmo-mode goal done ${JSON.stringify({ stopped: 'complete' })}`]);
  });

  test('one blocked verdict does not end the goal, three do', async () => {
    const blocked = SAY(false, true, true);
    const h = harness({ answers: [blocked, blocked, blocked] });

    await h.run();
    await h.run();
    // A one-off snag is not a verdict: the loop keeps going.
    expect(h.sent).toEqual(['/kabmo-mode goal continue', '/kabmo-mode goal continue']);

    await h.run();
    expect(h.sent.at(-1)).toBe(`/kabmo-mode goal done ${JSON.stringify({ stopped: 'blocked' })}`);
  });

  test('an audit that could not run continues once, then stops', async () => {
    const h = harness({ answers: [null, null] });
    await h.run();
    expect(h.sent).toEqual(['/kabmo-mode goal continue']);

    await h.run();
    expect(h.sent.at(-1)).toBe(`/kabmo-mode goal done ${JSON.stringify({ stopped: 'audit-failed' })}`);
  });

  test('a standing verdict keeps the loop down until Resume', async () => {
    const h = harness({ context: { goal, continuationStop: 'max-turns' } });
    await h.run();
    expect(h.sent).toEqual([]);
    expect(h.events).toEqual([]);
  });

  test('a goal that is not active is not driven at all', async () => {
    const h = harness({ context: null });
    await h.run();
    expect(h.sent).toEqual([]);
  });

  test('a turn with no assistant report is not auditable', async () => {
    const h = harness({ messages: [{ role: 'assistant', content: [{ type: 'text', text: '   ' }] }] });
    await h.run();
    expect(h.sent).toEqual([]);
    expect(h.events).toEqual([]);
  });

  test("a host whose send needs its receiver is still called with one", async () => {
    // The live bug: the driver destructured `host.send`, so the wrapper's own
    // `dispatchSessionCommand(this, …)` ran with `this === undefined` and threw
    // the moment the loop tried to continue. A method must be called on its
    // object, or bound to it.
    const calls: string[] = [];
    const host = {
      sessionId: `s-${Math.random().toString(36).slice(2)}`,
      cwd: '/tmp',
      calls,
      send(this: { calls: string[] }, command: Record<string, unknown>) {
        this.calls.push(String(command.message));
        return Promise.resolve(null);
      },
      emit: () => {},
    };
    resetGoalDriverState(host.sessionId);

    await driveGoalAfterTurn({
      host,
      messages: [{ role: 'assistant', content: [{ type: 'text', text: 'done and verified' }] }],
      deps: {
        audit: async () => SAY(false, true, false),
        context: async () => ({ goal, continuationStop: undefined }),
      },
    });

    expect(calls).toEqual(['/kabmo-mode goal continue']);
  });

  test('with the auditor switched off nothing is audited or advanced', async () => {
    const h = harness({ answers: SAY(false, true, false), auditEnabled: false });
    await h.run();
    // A goal still exists (pause/resume, the objective, the budget) — the loop
    // simply never continues on its own.
    expect(h.sent).toEqual([]);
    expect(h.events).toEqual([]);
  });

  test('a configured auditor model is asked instead of the session model', async () => {
    const asked: Array<string | undefined> = [];
    const h = harness({
      answers: SAY(false, true, false),
      auditModel: 'kenari/agnes-2-0-flash:free',
      onAudit: (request) => asked.push(request.model),
    });
    await h.run();
    expect(asked).toEqual(['kenari/agnes-2-0-flash:free']);
  });
});

describe('lastAssistantText', () => {
  test('takes the last assistant message, not a tool result or an earlier one', () => {
    const text = lastAssistantText([
      { role: 'assistant', content: [{ type: 'text', text: 'first' }] },
      { role: 'toolResult', content: [{ type: 'text', text: 'output' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'the report' }] },
    ]);
    expect(text).toBe('the report');
  });
});
