/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The child's half of the goal loop.
 *
 * The loop itself lives in Kabmo now: it audits each finished turn with an
 * independent model and then asks this extension to open the next one. What is
 * pinned here is everything that has to happen inside the child — the hidden
 * continuation message (an RPC prompt would leave a user bubble), the per-goal
 * turn count, and the two hard stops (token budget, turn ceiling) that must hold
 * even when Kabmo is not the one counting.
 */

import { beforeEach, describe, expect, test } from 'bun:test';
import {
  continueGoalTurn,
  createGoalFromSelection,
  finishGoalTurn,
  parseGoalArgs,
  resetGoalContinuationTurns,
  startGoalTurn,
  startGuidedGoal,
} from './goal';
import type { GoalRecord } from './protocol';
import { bindApi, type ExtensionCtx, type ModeApi, type ModeSession } from './session';

const MAX_TURNS_ENV = 'KABMO_GOAL_MAX_TURNS';

interface Harness {
  api: ModeApi;
  ctx: ExtensionCtx;
  /** Visible turns the session was asked to run (`session.prompt`). */
  prompts: string[];
  sent: Array<{ customType: string; content: string; display?: boolean }>;
  /** Entries the loop appended (the persisted verdict). */
  entries: Array<{ customType: string; data: Record<string, unknown> }>;
  /** Markers the loop emitted, in order. */
  markers: Array<{ marker: string; payload: Record<string, unknown> }>;
  /** The marker sink `continueGoalTurn` should be given. */
  emit: (ctx: ExtensionCtx, marker: string, payload: unknown) => void;
  setGoal: (status: GoalRecord['status'], enabled?: boolean) => void;
  /** Token usage as omp would report it, for the budget guard. */
  setUsage: (tokensUsed: number, tokenBudget?: number) => void;
  session: ModeSession;
}

function harness(): Harness {
  const prompts: string[] = [];
  const sent: Harness['sent'] = [];
  const entries: Harness['entries'] = [];
  const markers: Harness['markers'] = [];
  // A fresh id per harness: the turn counter is keyed by goal, so two tests
  // sharing one id would share its ceiling.
  let goal: GoalRecord = {
    id: `g${Math.random().toString(36).slice(2)}`,
    objective: 'ship it',
    status: 'active',
    tokensUsed: 0,
    timeUsedSeconds: 0,
    createdAt: 0,
    updatedAt: 0,
  };
  let enabled = true;

  const session: ModeSession = {
    prompt: async (text: string) => { prompts.push(text); },
    getGoalModeState: () => ({ goal, enabled }),
    goalRuntime: {
      // omp's own shape: `createGoal` answers the new record, which is how the
      // caller learns the goal id to hang its ceiling on.
      createGoal: async () => ({ goal }),
      resumeGoal: async () => goal,
      pauseGoal: async () => {},
      dropGoal: async () => {},
      onBudgetMutated: async () => {},
    },
  };

  const api: ModeApi = {
    sendMessage: (message, options) => {
      sent.push({ customType: message.customType, content: message.content, display: message.display });
      void options;
    },
    appendEntry: (customType, data) => {
      entries.push({ customType, data: (data ?? {}) as Record<string, unknown> });
    },
  };

  return {
    api,
    ctx: { cwd: '/tmp/goal-test', ui: { notify: () => {} } },
    prompts,
    sent,
    entries,
    markers,
    session,
    emit: (_ctx, marker, payload) => {
      markers.push({ marker, payload: (payload ?? {}) as Record<string, unknown> });
    },
    setGoal: (status, nextEnabled = true) => {
      goal = { ...goal, status };
      enabled = nextEnabled;
    },
    setUsage: (tokensUsed, tokenBudget) => {
      goal = tokenBudget === undefined ? { ...goal, tokensUsed } : { ...goal, tokensUsed, tokenBudget };
    },
  };
}

const continueTurn = (h: Harness) => continueGoalTurn({ api: h.api, session: h.session, emit: h.emit, ctx: h.ctx });
const finishTurn = (h: Harness, stopped: Parameters<typeof finishGoalTurn>[1]) =>
  finishGoalTurn({ api: h.api, session: h.session, emit: h.emit, ctx: h.ctx }, stopped);

beforeEach(() => {
  delete process.env[MAX_TURNS_ENV];
});

describe('continueGoalTurn', () => {
  test('opens the next turn as a HIDDEN message and reports the count', () => {
    const h = harness();
    continueTurn(h);

    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]?.customType).toBe('goal-continuation');
    expect(h.sent[0]?.display).toBe(false);
    expect(h.sent[0]?.content).toContain('Continue active goal');
    expect(h.markers).toEqual([{ marker: 'KABMO_GOAL_CONTINUATION:', payload: { turn: 1, maxTurns: 25 } }]);
    // Persisted on the way in, so a reload shows the count it stopped at.
    expect(h.entries.at(-1)?.data.continuation).toEqual({ turn: 1, maxTurns: 25 });
  });

  test('stands down at the ceiling instead of opening another turn', () => {
    process.env[MAX_TURNS_ENV] = '1';
    const h = harness();
    continueTurn(h);
    continueTurn(h);

    expect(h.sent).toHaveLength(1);
    expect(h.markers.at(-1)?.payload).toEqual({ turn: 1, maxTurns: 1, stopped: 'max-turns' });
    expect(h.entries.at(-1)?.data.continuation).toMatchObject({ stopped: 'max-turns' });
  });

  test('a spent budget is reported, and no turn is opened', () => {
    const h = harness();
    h.setUsage(1000, 1000);
    continueTurn(h);

    expect(h.sent).toEqual([]);
    expect(h.markers.at(-1)?.payload).toMatchObject({ stopped: 'budget' });
    expect(h.entries.at(-1)?.data.continuation).toMatchObject({ stopped: 'budget' });
  });

  test('omp having flipped the goal to budget-limited is reported too', () => {
    // Measured against a real child: omp marks the goal `budget-limited` the
    // moment the budget is spent, so the loop never sees an `active` goal and
    // this branch is the only place that can say so.
    const h = harness();
    h.setUsage(1203, 300);
    h.setGoal('budget-limited');
    continueTurn(h);

    expect(h.sent).toEqual([]);
    expect(h.markers.at(-1)?.payload).toMatchObject({ stopped: 'budget', turn: 1 });
  });

  test('a paused goal is not continued', () => {
    const h = harness();
    h.setGoal('paused');
    continueTurn(h);
    expect(h.sent).toEqual([]);
  });

  test('a resumed goal counts its ceiling from the start again', () => {
    process.env[MAX_TURNS_ENV] = '1';
    const h = harness();
    continueTurn(h);
    continueTurn(h);
    expect(h.sent).toHaveLength(1);

    // What Kabmo's Resume leads to: the count restarts, so the next
    // request opens a turn instead of standing down again.
    resetGoalContinuationTurns();
    continueTurn(h);
    expect(h.sent).toHaveLength(2);
    expect(h.markers.at(-1)?.payload).toEqual({ turn: 1, maxTurns: 1 });
  });

  test("the goal's own ceiling beats the install default, and is persisted", async () => {
    // The install default is 25; this goal was created with 2, and the number
    // must survive both the count and a fresh process (Kabmo replays it
    // on every continue).
    const h = harness();
    await createGoalFromSelection(h.session, { objective: 'ship it', maxTurns: 2 });
    continueTurn(h);
    continueTurn(h);
    h.sent.length = 0;
    continueTurn(h);

    expect(h.sent).toEqual([]);
    expect(h.markers.at(-1)?.payload).toMatchObject({ turn: 2, maxTurns: 2, stopped: 'max-turns' });
    expect(h.entries.at(-1)?.data.maxTurns).toBe(2);
  });

  test('a ceiling replayed by Kabmo overrides this process’s memory', () => {
    process.env[MAX_TURNS_ENV] = '20';
    const h = harness();
    continueGoalTurn({ api: h.api, session: h.session, emit: h.emit, ctx: h.ctx, maxTurns: 1 });
    continueGoalTurn({ api: h.api, session: h.session, emit: h.emit, ctx: h.ctx, maxTurns: 1 });

    // Ceiling 1 as Kabmo remembered it — not the process default of 20.
    expect(h.markers.at(-1)?.payload).toMatchObject({ turn: 1, maxTurns: 1, stopped: 'max-turns' });
    delete process.env[MAX_TURNS_ENV];
  });
});

describe('finishGoalTurn', () => {
  test("records the auditor's verdict without opening a turn", () => {
    const h = harness();
    continueTurn(h);
    finishTurn(h, 'complete');

    expect(h.sent).toHaveLength(1);
    expect(h.markers.at(-1)?.payload).toMatchObject({ stopped: 'complete', turn: 1 });
    expect(h.entries.at(-1)?.data.continuation).toMatchObject({ stopped: 'complete' });
  });

  test('a blocked verdict is recorded the same way', () => {
    const h = harness();
    finishTurn(h, 'blocked');
    expect(h.markers.at(-1)?.payload).toMatchObject({ stopped: 'blocked' });
  });
});

describe('startGoalTurn', () => {
  test('the objective is the first USER turn of the session', async () => {
    const h = harness();
    await startGoalTurn(h.session, 'ship it');
    // `createGoal` writes the record and opens nothing; this is the half that
    // makes the goal actually start. It goes through `session.prompt` — the same
    // entry point omp's own `/goal <objective>` uses — so the transcript opens
    // with the operator's objective instead of an answer to nobody. Measured
    // with the hidden form: `custom x8, assistant x3, toolResult x2, user x0`.
    expect(h.prompts).toEqual(['ship it']);
    expect(h.sent).toEqual([]);
  });

  test('a session that cannot take a prompt still opens a turn', async () => {
    const h = harness();
    // The RPC-side fallback: a build whose session has no `prompt` gets the
    // hidden custom message, which still triggers a turn — it just cannot show
    // the objective. A goal that never runs would be worse than a silent one.
    // The bind is module-level (`bindApi`, called once at extension load), so
    // the harness installs its own api here to observe the fallback.
    bindApi(h.api);
    const withoutPrompt: ModeSession = { ...h.session, prompt: undefined };
    await startGoalTurn(withoutPrompt, 'ship it');
    expect(h.sent).toEqual([{ customType: 'goal-start', content: 'ship it', display: false }]);
  });
});

describe('parseGoalArgs startTurn', () => {
  test('an absent flag means the goal opens its own turn', () => {
    // omp's own `/goal <objective>` behaviour, and the TUI's: the command is the
    // question, so the child opens the turn.
    expect(parseGoalArgs(JSON.stringify({ objective: 'ship it' })).startTurn).toBeUndefined();
  });

  test('false is carried through, so the operator prompt becomes turn one', () => {
    const parsed = parseGoalArgs(JSON.stringify({ objective: 'ship it', startTurn: false }));
    expect(parsed.startTurn).toBe(false);
    expect(parsed.objective).toBe('ship it');
  });

  test('any other value is ignored rather than read as false', () => {
    // A truthy string must not silently suppress the opening turn: only the
    // literal false is the armed path.
    expect(parseGoalArgs(JSON.stringify({ objective: 'x', startTurn: 'no' })).startTurn).toBeUndefined();
    expect(parseGoalArgs(JSON.stringify({ objective: 'x', startTurn: true })).startTurn).toBeUndefined();
  });
});

describe('startGuidedGoal', () => {
  test('the operator message is the visible content of turn one', async () => {
    const h = harness();
    await startGuidedGoal(h.session, 'speed up the test suite', '');

    expect(h.prompts).toHaveLength(1);
    const body = h.prompts[0];
    // The interview template's own slot, fed with what the operator typed — so
    // the transcript opens on their words, not on a question to nobody.
    expect(body).toContain('<rough-goal>');
    expect(body).toContain('speed up the test suite');
    // Nothing hidden was sent: the visible prompt IS the turn.
    expect(h.sent).toEqual([]);
  });

  test("the modal's rough idea rides along when the message does not carry it", async () => {
    const h = harness();
    await startGuidedGoal(h.session, 'speed up the test suite', 'the slow ones are the route specs');
    expect(h.prompts[0]).toContain('speed up the test suite');
    expect(h.prompts[0]).toContain('the slow ones are the route specs');
  });

  test('a session that cannot take a prompt falls back to the hidden kickoff', async () => {
    const h = harness();
    bindApi(h.api);
    const withoutPrompt: ModeSession = { ...h.session, prompt: undefined };
    await startGuidedGoal(withoutPrompt, 'speed up the tests', '');
    expect(h.sent.map((entry) => entry.customType)).toEqual(['guided-goal-interview']);
  });
});
