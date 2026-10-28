/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The `/kabmo-mode` dispatch rules that are NOT about actuation: the mutual
 * exclusion between plan mode and a goal, and the republish action a reloading
 * client uses to recover a parked review.
 *
 * Both exist because the composer's UI is not the only caller. `planAvailable`
 * only HIDES the Plan button under a goal, so a stale client, a second tab or a
 * typed `/plan` reached the child and turned both modes on — measured: the
 * persisted record read `plan True goal True` and the live child reported both
 * enabled, with a parked plan review the operator could no longer reach.
 *
 * The republish action exists because a parked proposal lives ONLY in the
 * extension's slot: the marker that announced it went out over a stream the
 * reloaded client was not attached to, and omp never re-delivers the frame.
 */

import { beforeEach, describe, expect, test } from 'bun:test';
import { dispatchGoal, dispatchPlan } from './commands';
import { awaitParkedProposal, installPlanProposal } from './plan';
import {
  KABMO_MODE_ERROR_MARKER,
  KABMO_PLAN_PROPOSAL_MARKER,
  KABMO_PLAN_STATE_MARKER,
  type GoalRecord,
} from './protocol';
import type { ExtensionCtx, ModeApi, ModeSession } from './session';

interface Harness {
  api: ModeApi;
  session: ModeSession;
  ctx: ExtensionCtx;
  notices: string[];
  appended: Array<{ customType: string; data: unknown }>;
  /** Drive the proposal handler `installPlanProposal` installs. */
  propose: (title: string) => Promise<void>;
  setGoal: (goal: GoalRecord | null, enabled: boolean) => void;
  setPlan: (enabled: boolean) => void;
}

function harness(): Harness {
  const notices: string[] = [];
  const appended: Harness['appended'] = [];
  let planState: { enabled: boolean; planFilePath: string } | undefined;
  let goal: GoalRecord | null = null;
  let goalEnabled = false;
  let handler: ((title: string) => Promise<unknown>) | undefined;

  const session: ModeSession = {
    getPlanModeState: () => planState,
    setPlanModeState: (state) => {
      planState = state;
    },
    setPlanProposalHandler: (next) => {
      handler = next ?? undefined;
    },
    getPlanReferencePath: () => 'local://PLAN.md',
    getEnabledToolNames: () => ['read'],
    setActiveToolsByName: async () => {},
    // omp's own shape: `undefined` when the session has no goal at all, which
    // is also what `goalStateRecord` treats as "no goal" (`!state?.goal`).
    getGoalModeState: () => (goal ? { goal, enabled: goalEnabled } : undefined),
    // `modeCapabilities` requires it, and the guard must be reached through the
    // same capability check production does — a harness missing this would pass
    // for the wrong reason (the "API missing" refusal).
    goalRuntime: {
      createGoal: async () => {
        goal = GOAL;
        return { goal };
      },
      resumeGoal: async () => goal,
      pauseGoal: async () => {},
      dropGoal: async () => {},
      onBudgetMutated: async () => {},
    },
    sessionManager: { appendModeChange: () => 'id', getSessionId: () => 's1' },
  };

  const api: ModeApi = {
    appendEntry: (customType, data) => appended.push({ customType, data }),
    sendMessage: () => {},
  };

  return {
    api,
    session,
    ctx: { cwd: '/tmp/mode-guard-test', ui: { notify: (message) => notices.push(message) } },
    notices,
    appended,
    propose: async (title) => {
      installPlanProposal(session, { cwd: '/tmp/mode-guard-test', ui: { notify: (message) => notices.push(message) } });
      if (!handler) throw new Error('proposal handler was not installed');
      void handler(title);
      await awaitParkedProposal();
    },
    setGoal: (next, enabled) => {
      goal = next;
      goalEnabled = enabled;
    },
    setPlan: (enabled) => {
      planState = enabled ? { enabled: true, planFilePath: 'local://PLAN.md' } : undefined;
    },
  };
}

/** The refusal reasons the extension reported, in order. */
function refusalReasons(h: Harness): string[] {
  const reasons: string[] = [];
  for (const notice of h.notices) {
    if (!notice.startsWith(KABMO_MODE_ERROR_MARKER)) continue;
    const parsed: unknown = JSON.parse(notice.slice(KABMO_MODE_ERROR_MARKER.length));
    if (parsed && typeof parsed === 'object' && 'reason' in parsed && typeof parsed.reason === 'string') {
      reasons.push(parsed.reason);
    }
  }
  return reasons;
}

/** Whether a `KABMO_PLAN_STATE` notice reported the mode as on. */
function planStateOf(h: Harness): boolean[] {
  const states: boolean[] = [];
  for (const notice of h.notices) {
    if (!notice.startsWith(KABMO_PLAN_STATE_MARKER)) continue;
    const parsed: unknown = JSON.parse(notice.slice(KABMO_PLAN_STATE_MARKER.length));
    states.push(Boolean(parsed && typeof parsed === 'object' && 'enabled' in parsed && parsed.enabled === true));
  }
  return states;
}

const GOAL: GoalRecord = {
  id: 'g1',
  objective: 'ship it',
  status: 'active',
  tokensUsed: 0,
  timeUsedSeconds: 0,
  createdAt: 0,
  updatedAt: 0,
};

beforeEach(() => {
  // The parked proposal is module-level state; clear it through the extension's
  // own teardown so one test cannot leak a review into the next.
  const h = harness();
  installPlanProposal(h.session, h.ctx, { clear: true });
});

describe('plan/goal mutual exclusion', () => {
  test('plan on is refused while a goal is live, and reports why', async () => {
    const h = harness();
    h.setGoal(GOAL, true);
    await dispatchPlan(h.api, h.session, h.ctx, 'on', '');
    expect(h.session.getPlanModeState?.()?.enabled).not.toBe(true);
    expect(refusalReasons(h)).toHaveLength(1);
    expect(refusalReasons(h)[0]).toContain('goal');
    // No state marker either: the console must not be told the mode changed.
    expect(planStateOf(h)).toHaveLength(0);
  });

  test('plan on still works when the goal is only PAUSED (not live work)', async () => {
    const h = harness();
    // `enabled: false` is omp's "not being pursued right now"; a paused record
    // is resumable but is not the exclusion the refusal describes.
    h.setGoal({ ...GOAL, status: 'paused' }, false);
    await dispatchPlan(h.api, h.session, h.ctx, 'on', '');
    expect(h.session.getPlanModeState?.()?.enabled).toBe(true);
    expect(refusalReasons(h)).toHaveLength(0);
    expect(planStateOf(h)).toEqual([true]);
  });

  test('goal create is refused while plan mode is active', async () => {
    const h = harness();
    h.setPlan(true);
    await dispatchGoal(h.api, h.session, h.ctx, 'create', '{"objective":"do a thing"}');
    expect(refusalReasons(h)).toHaveLength(1);
    expect(refusalReasons(h)[0]).toContain('plan mode');
    // Nothing was created, so the composer's Goal button stays off instead of
    // showing a goal the child refused to start.
    expect(h.session.getGoalModeState?.()).toBeUndefined();
  });
});

describe('republish', () => {
  test('a parked proposal is re-announced, byte for byte', async () => {
    const h = harness();
    await h.propose('migrate-importer');
    const before = h.notices.filter((n) => n.startsWith(KABMO_PLAN_PROPOSAL_MARKER));
    expect(before).toHaveLength(1);

    await dispatchPlan(h.api, h.session, h.ctx, 'republish', '');
    const after = h.notices.filter((n) => n.startsWith(KABMO_PLAN_PROPOSAL_MARKER));
    // The SAME marker: the reloaded client learns the request id and the body
    // the operator was already shown, not a re-read that could differ.
    expect(after).toHaveLength(2);
    expect(after[1]).toBe(before[0]);
  });

  test('republish is silent when nothing is parked', async () => {
    const h = harness();
    // This runs on EVERY attach, so an error here would paint a failure strip
    // on every chat the user opens.
    await dispatchPlan(h.api, h.session, h.ctx, 'republish', '');
    expect(refusalReasons(h)).toHaveLength(0);
    expect(h.notices.filter((n) => n.startsWith(KABMO_PLAN_PROPOSAL_MARKER))).toHaveLength(0);
  });
});
