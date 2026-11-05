/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * What `useChatTimelineModes` returns, declared apart from the hook.
 *
 * Split for the repo's per-file ceiling, and the seam is real: the CONTRACT is
 * read by the composer's prop shapes (`chat-input/modes-props.ts`), the goal
 * surfaces and their tests, while the hook file is the implementation. A field
 * added for a new surface therefore never has to be threaded through the hook's
 * own body to be visible.
 */

import type { KabmoModeSelection, GoalContinuation, GoalRecord } from '@/shared/lib/omp/mode/types';
import type { GoalActionResult } from '@/client/hooks/chat/timeline/goal-command';
import type { ArmedGoal, GoalAction } from '@/shared/lib/omp/mode/actions';

export interface ChatTimelineModes {
  plan: boolean;
  /** omp's own `enabled` flag: the agent is working toward the goal right now.
   *  False for a PAUSED goal, which still exists (see `goalOpen`). */
  goal: boolean;
  /** A goal this chat still owns — omp's `enabled` OR an open record. This is
   *  the flag every surface should gate on: pausing clears `enabled` while the
   *  record stays resumable, so gating on `goal` alone made the goal vanish
   *  from the composer (strip gone, button off, modal offering to create a
   *  second goal over the paused one). */
  goalOpen: boolean;
  goalRecord: GoalRecord | null;
  /**
   * The child's last automatic goal turn (`KABMO_GOAL_CONTINUATION`), or
   * null when the loop has not reported one for the current goal. Cleared when
   * the goal itself changes: a counter from the previous goal names a turn this
   * one never took.
   */
  goalContinuation: GoalContinuation | null;
  /**
   * True while the child's loop is deciding whether to open another automatic
   * turn. The decision is a synchronous guard chain with no other frame, so
   * this is the only signal for the window in which the goal is neither
   * streaming nor idle.
   */
  goalEvaluating: boolean;
  /** True while a mode command is in flight; the toggle shows a pending state
   *  rather than flipping optimistically and snapping back. */
  pending: boolean;
  /** omp refuses to enter one mode while the other is active, so Plan is not
   *  offered while Goal is on — a button whose only outcome is a refusal is
   *  worse than an absent one. The child enforces the same rule, because this
   *  flag only hides a button: a stale client or a typed `/plan` used to reach
   *  the child and turn both modes on. */
  planAvailable: boolean;
  /**
   * The last refusal, from either side of the wire: the route's own error, or a
   * `KABMO_MODE_ERROR` the extension emitted (an unknown action, a missing
   * omp API, the plan/goal exclusion). Surfaced by the composer because a mode
   * command that fails silently leaves the toggle pressed over a mode the child
   * is not in.
   */
  error: string | null;
  /** Clear the refusal once it has been shown. */
  clearError: () => void;
  /**
   * For a pending `new-…` chat only: the selection its spawn must carry, since
   * there is no child to command yet. Null once the session exists — from then
   * on the child is authoritative and the value is written to its transcript.
   *
   * A ref rather than a value because the reader is the SEND path
   * (`executeSend`), which runs outside the render that produced it.
   */
  spawnSelectionRef: { current: KabmoModeSelection | null };
  /**
   * The goal the operator has armed but not started: the objective (and its
   * limits) waiting for the next prompt to become the goal's first turn. Null
   * when no goal is armed.
   *
   * Surfaced as a VALUE, not only a ref, because the strip has to say what is
   * waiting — the button reading as "on" over a goal nothing is pursuing is
   * exactly the lie this state exists to avoid.
   */
  goalArm: ArmedGoal | null;
  /** Drop the armed goal without starting it. */
  disarmGoal: () => void;
  /** The same arm as a ref, for the SEND path (which runs outside a render). */
  goalArmRef: { current: ArmedGoal | null };
  onTogglePlan: (enabled: boolean) => void;
  /** Goal needs an objective, so the toggle opens a modal instead of sending a
   *  bare enable — see `GoalModal`. Resolves with the outcome because the modal
   *  closes only on success: a refusal keeps the form and its objective, so the
   *  user can read the reason and retry. */
  onGoalAction: (action: GoalAction) => Promise<GoalActionResult>;
}
