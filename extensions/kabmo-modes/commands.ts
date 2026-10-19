/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The `/kabmo-mode` command surface: which action each scope accepts, and
 * what it answers.
 *
 * Split out of `index.ts` for the file ceiling, and it is also the natural
 * seam — `index.ts` owns the extension's lifecycle (binding the API, the
 * command registration, the event handlers), while everything here is a pure
 * dispatch over a session the caller already resolved.
 */

import {
  ensureGoalTool,
  enterPlanMode,
  exitPlanMode,
  modeCapabilities,
  recordPlanState,
  type ExtensionCtx,
  type ModeApi,
  type ModeSession,
} from './session';
import {
  KABMO_GOAL_STATE_MARKER,
  KABMO_MODE_ERROR_MARKER,
  KABMO_MODE_STATE_MARKER,
  KABMO_PLAN_STATE_MARKER,
  type GoalContinuationStop,
} from './protocol';
import {
  continueGoalTurn,
  createGoalFromSelection,
  finishGoalTurn,
  goalStateRecord,
  parseGoalArgs,
  persistContinuation,
  resetGoalContinuationTurns,
  startGoalTurn,
  startGuidedGoal,
} from './goal';
import { decidePlan, installPlanProposal, republishParkedProposal } from './plan';

/** Report an outcome through the notice channel, which is how Kabmo
 *  learns the new state without polling (the frame reaches it over the same
 *  event stream the transcript uses). */
export function emit(ctx: ExtensionCtx, marker: string, payload: unknown): void {
  ctx.ui?.notify?.(`${marker}${JSON.stringify(payload)}`, 'info');
}

/**
 * Report a refusal, tagged with the SCOPE it belongs to.
 *
 * The tag is what lets the console roll the right toggle back: both toggles
 * flip optimistically, and an untagged refusal would leave the client guessing
 * whether the plan button or the goal button is the one that lied.
 */
function emitModeError(ctx: ExtensionCtx, scope: 'plan' | 'goal', reason: string): void {
  emit(ctx, KABMO_MODE_ERROR_MARKER, { scope, reason });
}

/** Parse a command's trailing JSON payload; a bare string is the objective. */
export function parsePayload(rest: string): Record<string, unknown> {
  const trimmed = rest.trim();
  if (!trimmed) return {};
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return { objective: trimmed };
  }
}

export async function dispatchPlan(
  api: ModeApi,
  session: ModeSession,
  ctx: ExtensionCtx,
  action: string,
  rest: string,
): Promise<void> {
  if (!modeCapabilities(session).plan) {
    emitModeError(ctx, 'plan', 'plan-mode API missing in this omp build');
    return;
  }
  if (action === 'on') {
    // omp refuses to enter one mode while the other is live, and so must this:
    // the composer only HIDES the Plan button under a goal, so a stale client,
    // a typed `/plan`, or a second tab reached the child and turned BOTH on
    // (measured: persisted `plan True goal True`, live child reporting both
    // enabled). The refusal is reported rather than silently dropped, because
    // the client's optimistic flip would otherwise leave a pressed button over
    // a mode the child is not in.
    if (goalStateRecord(session).enabled) {
      emitModeError(ctx, 'plan', 'Cannot enter plan mode while a goal is active. Drop or pause the goal first.');
      return;
    }
    const planFilePath = session.getPlanReferencePath?.() || 'local://PLAN.md';
    await enterPlanMode(session, planFilePath);
    installPlanProposal(session, ctx);
    recordPlanState(api, true);
    emit(ctx, KABMO_PLAN_STATE_MARKER, { enabled: true, planFilePath });
    return;
  }
  if (action === 'off') {
    installPlanProposal(session, ctx, { clear: true });
    exitPlanMode(session);
    recordPlanState(api, false);
    emit(ctx, KABMO_PLAN_STATE_MARKER, { enabled: false, planFilePath: '' });
    return;
  }
  if (action === 'decide') {
    const payload = parsePayload(rest);
    const choice = typeof payload.choice === 'string' ? payload.choice : '';
    const feedback = typeof payload.feedback === 'string' ? payload.feedback : '';
    const handled = await decidePlan(api, session, ctx, choice, feedback);
    if (!handled) emitModeError(ctx, 'plan', 'no plan is awaiting review');
    return;
  }
  if (action === 'republish') {
    // Asked by a client attaching to a live session, because a parked proposal
    // is otherwise unreachable after a reload: it exists only in the extension's
    // slot, and the marker that announced it went out over a stream this client
    // was not attached to.
    //
    // Deliberately SILENT when nothing is parked: this runs on every attach, so
    // an error here would paint a failure strip on every chat the user opens.
    // The client's positive signal is the proposal marker itself.
    republishParkedProposal(ctx);
    return;
  }
  if (action === 'state') {
    emit(ctx, KABMO_MODE_STATE_MARKER, { plan: session.getPlanModeState?.() ?? null, goal: goalStateRecord(session) });
    return;
  }
  emitModeError(ctx, 'plan', `unknown plan action: ${action}`);
}

export async function dispatchGoal(
  api: ModeApi,
  session: ModeSession,
  ctx: ExtensionCtx,
  action: string,
  rest: string,
): Promise<void> {
  if (!modeCapabilities(session).goal) {
    emitModeError(ctx, 'goal', 'goal-mode API missing in this omp build');
    return;
  }
  // The other half of the exclusion `dispatchPlan` enforces: omp refuses to
  // start a goal while plan mode is active, and creating one here used to leave
  // both modes on with a parked plan review nobody could reach.
  //
  // Checked BEFORE `ensureGoalTool`, because a refusal must not have a side
  // effect: widening the active tool set on a command that is about to be
  // rejected would leave the child holding a tool its mode does not allow.
  const planActive = action === 'create' && session.getPlanModeState?.()?.enabled === true;
  if (planActive) {
    emitModeError(ctx, 'goal', 'Cannot start a goal while plan mode is active. Leave plan mode first.');
    return;
  }
  if (!(await ensureGoalTool(api, session))) {
    emitModeError(ctx, 'goal', 'could not enable the goal tool for this session');
    return;
  }
  const runtime = session.goalRuntime;

  switch (action) {
    case 'create': {
      const { objective, tokenBudget, maxTurns } = parseGoalArgs(rest);
      if (!objective) {
        emitModeError(ctx, 'goal', 'an objective is required');
        return;
      }
      await createGoalFromSelection(session, { objective, tokenBudget, maxTurns });
      // Both halves of what omp's own `/goal <objective>` does: the record AND
      // the opening turn. `createGoal` opens no turn by itself, so without the
      // second call the goal went live with an idle child — measured on a real
      // session, where the toggle read `goalLive` and nothing ever ran. From
      // there Kabmo drives: it audits this turn and calls `continue`.
      startGoalTurn(api, objective);
      emit(ctx, KABMO_GOAL_STATE_MARKER, goalStateRecord(session));
      return;
    }
    // The Kabmo's goal driver asks for one more automatic turn after its
    // auditor said "keep going". The hidden message can only be sent from in
    // here, and so are the two hard stops that back the auditor up.
    case 'continue':
      continueGoalTurn({ api, session, emit, ctx, maxTurns: parseGoalArgs(rest).maxTurns });
      return;
    // The auditor's terminal verdict (`complete`, `blocked`, or an audit that
    // could not be taken): record why the loop stopped driving.
    case 'done': {
      const { stopped } = parseGoalArgs(rest);
      finishGoalTurn({ api, session, emit, ctx }, (stopped ?? 'complete') as GoalContinuationStop);
      return;
    }
    case 'guided': {
      // The interview ends with the MODEL calling `goal({op:"create"})`, which
      // is why the tool had to be enabled above — the `goal_updated` it emits
      // is what turns the toggle on.
      startGuidedGoal(api, rest.trim());
      return;
    }
    case 'pause':
      await runtime?.pauseGoal();
      // The verdict describes a loop that was running; while the goal is paused
      // it is stale, and Resume clears it outright — so neither state should be
      // recoverable as "stopped at N turns" after a reload.
      persistContinuation(api, session, null);
      emit(ctx, KABMO_GOAL_STATE_MARKER, goalStateRecord(session));
      return;
    case 'resume':
      await runtime?.resumeGoal();
      // A resumed goal must loop too, and the operator just asked for it. The
      // turn counter restarts with it: a goal that stopped at `max-turns` would
      // otherwise stand down again on the very next decision, making Resume a
      // button that does nothing until the child is restarted. The Kabmo
      // nudges the loop right after this answers, so an idle session starts
      // working without waiting for a user message.
      resetGoalContinuationTurns();
      persistContinuation(api, session, null);
      emit(ctx, KABMO_GOAL_STATE_MARKER, goalStateRecord(session));
      return;
    case 'drop':
      await runtime?.dropGoal();
      emit(ctx, KABMO_GOAL_STATE_MARKER, { goal: null, enabled: false });
      return;
    case 'budget': {
      const value = rest.trim();
      const budget = value === 'off' || value === '' ? undefined : Number.parseInt(value, 10);
      if (budget !== undefined && (!Number.isInteger(budget) || budget <= 0)) {
        emitModeError(ctx, 'goal', 'budget must be a positive integer, or `off`');
        return;
      }
      await runtime?.onBudgetMutated(budget);
      emit(ctx, KABMO_GOAL_STATE_MARKER, goalStateRecord(session));
      return;
    }
    case 'state':
      emit(ctx, KABMO_GOAL_STATE_MARKER, goalStateRecord(session));
      return;
    default:
      emitModeError(ctx, 'goal', `unknown goal action: ${action}`);
  }
}
