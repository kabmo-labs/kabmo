/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Goal-mode actuation and the auto-continuation loop, inside the omp child.
 *
 * ## Why the loop lives here and not in Kabmo server
 *
 * The TUI's `#scheduleGoalContinuation` (`interactive-mode.ts`) is
 * interactive-only, so `--mode rpc-ui` never re-opens a goal turn on its own —
 * without this, Goal mode runs exactly one turn and stops, which is not the
 * "keeps working across turns" the feature is for.
 *
 * The obvious server-side implementation does not work: the RPC command union
 * has `prompt`/`steer`/`follow_up` and nothing else, so a Kabmo-sent
 * continuation arrives as a VISIBLE USER MESSAGE and every automatic turn would
 * leave a "Continue active goal." bubble in the transcript. The extension can
 * send a hidden custom message (`display: false`), which is exactly what the
 * TUI does — and it also sees `agent_end.willContinue`, the one signal that
 * says omp has already scheduled its own continuation.
 *
 * The Kabmo still owns the on/off decision (the composer toggle) and Pause:
 * the loop only fires while `status === 'active'`, and Pause flips that.
 */

import { GOAL_CONTINUATION_PROMPT, GUIDED_GOAL_INTERVIEW_PROMPT, renderPrompt } from './prompts';
import type { ExtensionCtx, ModeApi, ModeSession } from './session';
import {
  KABMO_GOAL_CONTINUATION_MARKER,
  KABMO_GOAL_EVALUATING_MARKER,
  KABMO_GOAL_STATE_ENTRY,
  type GoalContinuation,
  type GoalContinuationStop,
  type GoalRecord,
} from './protocol';

/**
 * Ask the loop to forget how many automatic turns it has taken.
 *
 * The counter is per goal and per session, and the ceiling is what stops the
 * loop — so without this a goal that hit `max-turns` cannot be resumed: the
 * next decision recomputes `turns >= ceiling` from the same counter and stands
 * down again, leaving Resume a button that appears to do nothing until the
 * child restarts. Applied on the next decision, which is the first moment the
 * counter is read.
 */
let continuationTurnsReset = false;

export function resetGoalContinuationTurns(): void {
  continuationTurnsReset = true;
}

/**
 * Write the loop's verdict onto the session branch, beside the mode record the
 * console already reads for the composer's toggles.
 *
 * It has to be persisted, not only reported: the turn count lives in THIS
 * process's memory, so without the entry a reload (or a second tab) would show
 * a goal as active with nothing left to run it, and no way to tell that
 * automatic continuation had already stood down. The payload carries the whole
 * mode record — `readPersistedModes` takes the newest `kabmo-goal-state` as
 * the state, so a verdict-only entry would wipe the goal it describes.
 *
 * `null` clears it (Resume restarts the count, so the old verdict is a lie).
 */
export function persistContinuation(
  api: ModeApi,
  session: ModeSession,
  continuation: GoalContinuation | null,
  maxTurns?: number,
): void {
  api.appendEntry?.(KABMO_GOAL_STATE_ENTRY, {
    ...goalStateRecord(session),
    continuation,
    // The goal's own ceiling rides the same entry: the verdict is cleared on
    // Resume while the ceiling must survive, and this file is the only place
    // that outlives the process.
    ...(maxTurns === undefined ? {} : { maxTurns }),
  });
}

/** Hard ceiling on automatic turns for one goal. The token budget is the
 *  primary guard, but a goal with `budget off` has none — and an agent that
 *  keeps finding work would otherwise run until the process is killed.
 *
 * Both spellings are read: the current one is what this build's spawn path
 * exports, and the pre-rename one is what an older Kabmo (or a hand-written
 * environment) still carries. */
const MAX_TURNS_ENV = 'KABMO_GOAL_MAX_TURNS';
const LEGACY_MAX_TURNS_ENV = 'CHAMBER_GOAL_MAX_TURNS';
const DEFAULT_MAX_TURNS = 25;

/** Per-goal ceilings, keyed by goal id. A goal's own `maxTurns` beats the
 *  install default for its whole life, including after a Resume. */
const goalCeilings = new Map<string, number>();

function ceilingFor(goalId: string): number {
  const raw = process.env?.[MAX_TURNS_ENV] ?? process.env?.[LEGACY_MAX_TURNS_ENV] ?? '';
  const configured = Number.parseInt(raw, 10);
  const fallback = Number.isInteger(configured) && configured > 0 ? configured : DEFAULT_MAX_TURNS;
  return goalCeilings.get(goalId) ?? fallback;
}

/** Custom-message types, matching the TUI's own naming so a transcript written
 *  by either surface reads the same. */
const GOAL_CONTINUATION_TYPE = 'goal-continuation';
const GUIDED_GOAL_TYPE = 'guided-goal-interview';
/** The opening turn of a goal. Distinct from `goal-continuation` because the
 *  transcript should read as one started objective, not as a continuation. */
const GOAL_START_TYPE = 'goal-start';

interface GoalArgs {
  objective?: string;
  tokenBudget?: number;
  guided?: string;
  /** Automatic-turn ceiling for THIS goal; overrides the install default. */
  maxTurns?: number;
  /** The auditor's terminal reason, carried by the `done` action. */
  stopped?: GoalContinuationStop;
}

/** Parse the JSON payload a Kabmo command carries.
 *
 *  The payload is JSON rather than `key=value` pairs because an objective is
 *  free-form text: it holds spaces, punctuation and newlines, and JSON encodes
 *  every one of them onto a single line — which matters because the whole
 *  command travels as one prompt line. */
export function parseGoalArgs(rest: string): GoalArgs {
  const trimmed = rest.trim();
  if (!trimmed) return {};
  let payload: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    payload =
      parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    // Not JSON: treat the raw text as the objective, so a hand-typed
    // `/kabmo-mode goal create fix the build` still does something sane.
    payload = { objective: trimmed };
  }
  const objective = typeof payload.objective === 'string' ? payload.objective.trim() : undefined;
  const guided = typeof payload.guided === 'string' ? payload.guided : undefined;
  // The Kabmo's auditor reports its terminal verdict through `done`; the
  // reason travels so the strip can name it (and so a reload can too).
  const stopped = payload.stopped === 'budget' || payload.stopped === 'max-turns' || payload.stopped === 'blocked' || payload.stopped === 'complete' || payload.stopped === 'audit-failed'
    ? payload.stopped
    : undefined;
  const rawBudget = payload.tokenBudget;
  const tokenBudget =
    typeof rawBudget === 'number' && Number.isInteger(rawBudget) && rawBudget > 0 ? rawBudget : undefined;
  // A per-goal ceiling: the install default is fine until someone wants a
  // short leash on one objective, and then the number belongs to the goal.
  const rawMaxTurns = payload.maxTurns;
  const maxTurns =
    typeof rawMaxTurns === 'number' && Number.isInteger(rawMaxTurns) && rawMaxTurns > 0 ? rawMaxTurns : undefined;
  return { objective, tokenBudget, guided, maxTurns, stopped };
}

/** The record Kabmo mirrors. `enabled` is what decides whether the
 *  composer's toggle reads as on; a paused goal keeps its record. */
export function goalStateRecord(session: ModeSession): { goal: GoalRecord | null; enabled: boolean } {
  const state = session.getGoalModeState?.();
  if (!state?.goal) return { goal: null, enabled: false };
  return { goal: state.goal as GoalRecord, enabled: state.enabled };
}

/**
 * Create a goal, or resume the paused one.
 *
 * `createGoal` refuses a session that already carries a goal — omp throws
 * "cannot create a new goal because this session already has a goal" for any
 * status but `dropped`/`complete`. The composer's Goal toggle is a single
 * button, so pressing it on a paused session must resume rather than fail.
 */
export async function createGoalFromSelection(
  session: ModeSession,
  input: { objective: string; tokenBudget?: number; maxTurns?: number },
): Promise<void> {
  const runtime = session.goalRuntime;
  if (!runtime) throw new Error('goal runtime unavailable');
  const existing = session.getGoalModeState?.();
  if (existing?.goal && existing.goal.status === 'paused') {
    await runtime.resumeGoal();
    if (input.maxTurns !== undefined) goalCeilings.set(existing.goal.id, input.maxTurns);
    return;
  }
  const created = (await runtime.createGoal({ objective: input.objective, tokenBudget: input.tokenBudget })) as
    | { goal?: { id?: string } }
    | undefined;
  // The ceiling belongs to the goal, not to the process: remembered by id so
  // every later decision (and a Resume) reads the same number.
  const goalId = created?.goal?.id ?? session.getGoalModeState?.()?.goal?.id;
  if (goalId && input.maxTurns !== undefined) goalCeilings.set(goalId, input.maxTurns);
}

/**
 * The turn that makes a freshly created goal actually start.
 *
 * `createGoal` only writes the record — it opens no turn, so a goal created
 * here sat live with an idle child until the operator happened to send
 * something else, which is not "keeps working across turns". omp's own
 * `/goal <objective>` path does both (`#zs`: `#Tn({objective})` then a prompt
 * with the objective as text), and this is that second half.
 *
 * Sent as a hidden custom message rather than through the RPC prompt path: the
 * Kabmo cannot reach the live session's prompt, and `display: false` is what
 * keeps the objective out of the transcript as a second user bubble.
 */
export function startGoalTurn(api: ModeApi, objective: string): void {
  api.sendMessage?.({ customType: GOAL_START_TYPE, content: objective, display: false }, { triggerTurn: true });
}

/**
 * Start the guided-goal interview.
 *
 * A normal conversation with a hidden kickoff: the agent asks its questions as
 * ordinary assistant turns, the operator answers in the composer, and the model
 * closes by calling `goal({op:"create"})` itself — which flips goal mode on
 * through `goal_updated`. The `goal` tool must already be active, which is what
 * the caller's `ensureGoalTool` provides.
 */
export function startGuidedGoal(api: ModeApi, rough: string): void {
  const content = renderPrompt(GUIDED_GOAL_INTERVIEW_PROMPT, { initial: rough || undefined });
  api.sendMessage?.({ customType: GUIDED_GOAL_TYPE, content, display: false }, { triggerTurn: true });
}

/**
 * The loop's per-session counters, kept where the other process-wide state is:
 * a `bun --hot` reload must not lose the turn count, and the ceiling is the only
 * thing standing between `budget off` and an unbounded run.
 */
const turnCounters = new Map<string, number>();

function turnsFor(goalId: string): number {
  return turnCounters.get(goalId) ?? 0;
}

/** What Kabmo's goal driver needs to open one more turn. */
export interface GoalTurnRequest {
  api: ModeApi;
  session: ModeSession;
  emit: (ctx: ExtensionCtx, marker: string, payload: unknown) => void;
  ctx: ExtensionCtx;
  /** The goal's ceiling as Kabmo persisted it; beats this process's own
   *  memory, which a restart (or another instance) never had. */
  maxTurns?: number;
}

/**
 * Open the next automatic turn, at Kabmo's request.
 *
 * The Kabmo owns the loop now: it audits the last turn with an independent
 * model and calls this to continue. What stays here is everything Kabmo
 * cannot do or see — the hidden message that re-enters the loop without leaving
 * a user bubble, the per-goal turn count, and the two hard stops (token budget,
 * turn ceiling) that must hold even if Kabmo is restarted mid-run.
 */
export function continueGoalTurn({ api, session, emit, ctx, maxTurns }: GoalTurnRequest): void {
  const state = session.getGoalModeState?.();
  // A ceiling Kabmo remembers (persisted with the goal) wins: this
  // process's map is empty after a restart, and the goal's own number must not
  // be lost to that.
  if (state?.goal && maxTurns !== undefined) goalCeilings.set(state.goal.id, maxTurns);
  const ceiling = state?.goal ? ceilingFor(state.goal.id) : DEFAULT_MAX_TURNS;

  const standDown = (stopped: GoalContinuationStop, turns: number): void => {
    const verdict: GoalContinuation = { turn: Math.max(1, turns), maxTurns: ceiling, stopped };
    emit(ctx, KABMO_GOAL_EVALUATING_MARKER, { evaluating: false, stopped });
    emit(ctx, KABMO_GOAL_CONTINUATION_MARKER, verdict);
    persistContinuation(api, session, verdict, ceiling);
  };

  // omp flips the goal to `budget-limited` the moment the budget is spent, so
  // the loop never sees an `active` goal to decide about — this is the only
  // place that can report it. Without this the row showed a budget-limited goal
  // in silence, indistinguishable from one waiting for the next turn.
  if (state?.enabled && state.goal.status === 'budget-limited') {
    standDown('budget', turnsFor(state.goal.id));
    return;
  }
  if (!state?.enabled || state.goal.status !== 'active') return;

  if (continuationTurnsReset) {
    continuationTurnsReset = false;
    turnCounters.delete(state.goal.id);
  }
  let turns = turnsFor(state.goal.id);

  const goal = state.goal as GoalRecord;
  const budget = goal.tokenBudget;
  // The hard stops, checked here because THIS process is the one that has to
  // stop: Kabmo's auditor decides progress, never the ceilings.
  if (budget !== undefined && goal.tokensUsed >= budget) {
    standDown('budget', turns);
    return;
  }
  if (turns >= ceiling) {
    standDown('max-turns', turns);
    return;
  }

  turns += 1;
  turnCounters.set(state.goal.id, turns);
  const verdict: GoalContinuation = { turn: turns, maxTurns: ceiling };
  emit(ctx, KABMO_GOAL_CONTINUATION_MARKER, verdict);
  // Persisted on the way IN as well: the turn number is what a reload shows
  // until the loop reports again, and the ceiling rides with it so a resumed
  // process reads the goal's own number instead of the install default.
  persistContinuation(api, session, verdict, ceiling);
  const content = renderPrompt(GOAL_CONTINUATION_PROMPT, {
    objective: goal.objective,
    tokensUsed: goal.tokensUsed,
    tokenBudget: budget === undefined ? 'none' : budget,
    remainingTokens: budget === undefined ? 'unbounded' : Math.max(0, budget - goal.tokensUsed),
    timeUsedSeconds: goal.timeUsedSeconds,
  });
  api.sendMessage?.({ customType: GOAL_CONTINUATION_TYPE, content, display: false }, { triggerTurn: true });
}

/**
 * Close the loop with a verdict the AUDITOR reached (`complete`, `blocked`, or
 * an audit that could not be taken). The goal record itself is omp's — this
 * only records why Kabmo stopped driving it, so the strip can name it and
 * a reload can show it.
 */
export function finishGoalTurn({ api, session, emit, ctx }: GoalTurnRequest, stopped: GoalContinuationStop): void {
  const state = session.getGoalModeState?.();
  const ceiling = state?.goal ? ceilingFor(state.goal.id) : DEFAULT_MAX_TURNS;
  const turns = state?.goal ? turnsFor(state.goal.id) : 0;
  const verdict: GoalContinuation = { turn: Math.max(1, turns), maxTurns: ceiling, stopped };
  emit(ctx, KABMO_GOAL_CONTINUATION_MARKER, verdict);
  persistContinuation(api, session, verdict, ceiling);
}
