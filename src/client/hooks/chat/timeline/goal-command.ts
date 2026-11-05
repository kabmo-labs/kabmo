/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The composer's Goal command surface: what each `GoalAction` sends, and the
 * local mirror it applies when the child accepts.
 *
 * Split from `modes.ts` because that hook owns the shared state and this is a
 * closed translation — one action in, one command out plus a state patch. The
 * mirror exists because the marker that confirms the transition arrives over
 * the session's event stream, and the strip's controls are the only feedback
 * the user gets: measured after a dev-server restart (which kills the child and
 * the client's socket), a Resume answered 200 and the goal went active in the
 * child while the row kept reading "paused" indefinitely, because nothing
 * re-attached the stream.
 */

import type { GoalContinuation, GoalRecord } from '@/shared/lib/omp/mode/types';
import type { GoalAction } from '@/shared/lib/omp/mode/actions';
import type { ModeCommandResult } from '@/client/hooks/chat/timeline/mode-post';

/** What one goal command produced. The modal closes on `ok` and keeps the form
 *  open (with its objective) otherwise, so a refusal can be read and retried
 *  instead of throwing away what the user typed. */
export interface GoalActionResult {
  ok: boolean;
  /** Why it was refused — the route's own sentence, or the child's. */
  error?: string;
  /** Set when the action started a session (a pending chat's goal). */
  sessionId?: string;
  /** True when the goal was RECORDED for the next prompt instead of created:
   *  the operator has set an objective, and nothing runs until they send. */
  armed?: boolean;
}

/** Everything the goal commands need from the hook that owns the state. */
export interface GoalCommandHost {
  /** Dispatch one mode command to the live child. Resolves with the route's
   *  refusal reason, which is the same sentence the composer renders — the
   *  handler must not re-derive it from state that may not have flushed. */
  send: (scope: 'goal', action: string, payload?: Record<string, unknown>) => Promise<ModeCommandResult>;
  setGoalState: (enabled: boolean) => void;
  setGoalRecord: (update: (prev: GoalRecord | null) => GoalRecord | null) => void;
  setGoalContinuation: (continuation: GoalContinuation | null) => void;
}

/** A refusal result, with the reason the caller supplied. */
function refused(error: string | undefined, fallback: string): GoalActionResult {
  return { ok: false, error: error ?? fallback };
}

/**
 * Build the `onGoalAction` handler for one hook instance.
 *
 * Pause and Resume also drop the last turn's verdict: the loop's ceiling count
 * starts over in the child (`resetGoalContinuationTurns`), and omp's own resume
 * opens no turn, so a "stopped at 25 turns" row left standing would describe a
 * state the operator just left.
 *
 * Every action RESOLVES: the modal decides whether to close from the outcome,
 * and a refused command must leave the form — and the objective typed into it —
 * on screen.
 */
export function createGoalAction(host: GoalCommandHost): (action: GoalAction) => Promise<GoalActionResult> {
  const { send, setGoalState, setGoalRecord, setGoalContinuation } = host;

  return async (action: GoalAction): Promise<GoalActionResult> => {
    if (action.kind === 'create') {
      const posted = await send('goal', 'create', {
        objective: action.objective,
        tokenBudget: action.tokenBudget,
        maxTurns: action.maxTurns,
      });
      if (!posted.ok) return refused(posted.error, 'The goal was refused.');
      setGoalContinuation(null);
      return { ok: true };
    }
    if (action.kind === 'guided') {
      const posted = await send('goal', 'guided', { rough: action.rough });
      if (!posted.ok) return refused(posted.error, 'The interview could not start.');
      setGoalContinuation(null);
      return { ok: true };
    }
    if (action.kind === 'budget') {
      const posted = await send('goal', 'budget', { value: action.value });
      return posted.ok ? { ok: true } : refused(posted.error, 'The budget was refused.');
    }
    const posted = await send('goal', action.kind);
    if (!posted.ok) return refused(posted.error, 'The mode command was refused.');
    if (action.kind === 'pause') {
      setGoalState(false);
      setGoalRecord((prev) => (prev ? { ...prev, status: 'paused' } : prev));
    } else if (action.kind === 'resume') {
      setGoalState(true);
      setGoalRecord((prev) => (prev ? { ...prev, status: 'active' } : prev));
      setGoalContinuation(null);
    } else if (action.kind === 'drop') {
      setGoalState(false);
      setGoalRecord(() => null);
      setGoalContinuation(null);
    }
    return { ok: true };
  };
}
