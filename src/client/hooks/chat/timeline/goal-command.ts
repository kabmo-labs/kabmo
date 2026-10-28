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
import type { GoalAction } from '@/client/hooks/chat/timeline/modes';

/** Everything the goal commands need from the hook that owns the state. */
export interface GoalCommandHost {
  /** Dispatch one mode command to the live child; false when it was refused. */
  send: (scope: 'goal', action: string, payload?: Record<string, unknown>) => Promise<boolean>;
  setGoalState: (enabled: boolean) => void;
  setGoalRecord: (update: (prev: GoalRecord | null) => GoalRecord | null) => void;
  setGoalContinuation: (continuation: GoalContinuation | null) => void;
}

/**
 * Build the `onGoalAction` handler for one hook instance.
 *
 * Pause and Resume also drop the last turn's verdict: the loop's ceiling count
 * starts over in the child (`resetGoalContinuationTurns`), and omp's own resume
 * opens no turn, so a "stopped at 25 turns" row left standing would describe a
 * state the operator just left.
 */
export function createGoalAction(host: GoalCommandHost): (action: GoalAction) => void {
  const { send, setGoalState, setGoalRecord, setGoalContinuation } = host;

  return (action: GoalAction) => {
    if (action.kind === 'create') {
      void send('goal', 'create', {
        objective: action.objective,
        tokenBudget: action.tokenBudget,
        maxTurns: action.maxTurns,
      }).then((ok) => { if (ok) setGoalContinuation(null); });
      return;
    }
    if (action.kind === 'guided') {
      void send('goal', 'guided', { rough: action.rough }).then((ok) => { if (ok) setGoalContinuation(null); });
      return;
    }
    if (action.kind === 'budget') {
      void send('goal', 'budget', { value: action.value });
      return;
    }
    void send('goal', action.kind).then((ok) => {
      if (!ok) return;
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
    });
  };
}
