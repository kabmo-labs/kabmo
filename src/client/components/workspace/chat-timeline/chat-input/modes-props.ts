/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The plan/goal slice of the composer's props.
 *
 * Its own module because three components thread it (the toolbar, the input and
 * the dock) and each one only passes it through — a shared shape keeps the
 * signature identical at every hop, so a field added for the modal cannot be
 * dropped by an intermediate component.
 */

import type { GoalContinuation, GoalRecord } from '@/shared/lib/omp/mode/types';
import type { ArmedGoal, GoalAction } from '@/shared/lib/omp/mode/actions';
import type { GoalActionResult } from '@/client/hooks/chat/timeline/goal-command';
import type { SessionModeState } from '@/shared/lib/harness/session-modes';

export interface ComposerModes {
  plan: boolean;
  goal: boolean;
  /** A goal the chat still owns (see `ChatTimelineModes.goalOpen`): what the
   *  Goal button's pressed state and the modal's view are decided from. */
  goalOpen: boolean;
  goalRecord: GoalRecord | null;
  /** The child's last automatic goal turn, or null when it has not reported
   *  one. Read by the goal strip above the composer, not by the toolbar. */
  goalContinuation: GoalContinuation | null;
  /** The loop is deciding whether to open another automatic turn. */
  goalEvaluating: boolean;
  /**
   * A goal the operator set but has not started. It is NOT `goalOpen`: no child
   * record exists until the next prompt creates it, so this is what the strip
   * and the button read while the goal waits.
   */
  goalArm: ArmedGoal | null;
  /** Cancel the armed goal. */
  disarmGoal: () => void;
  pending: boolean;
  /** Plan is hidden while Goal is on: omp refuses to enter one mode while the
   *  other is active, so offering both would present a button whose only
   *  outcome is a refusal. */
  planAvailable: boolean;
  /**
   * Goal is offered only where a `/kabmo-mode` extension exists (omp's two
   * transports). A non-omp ACP agent has none — its own mode selector is the
   * only place plan can live, and nothing can express an objective — so the
   * button could only refuse.
   */
  goalAvailable: boolean;
  /** The agent's own mode selector (ACP), or null when it publishes none. */
  sessionMode?: SessionModeState | null;
  /** Move the agent's mode selector. */
  onSelectSessionMode?: (value: string) => void;
  /**
   * The last mode-command refusal, from either side of the wire (the route's
   * error, or a `KABMO_MODE_ERROR` from the extension). The composer renders
   * it, because a command that failed silently left the toggle pressed over a
   * mode the child is not in.
   */
  error: string | null;
  /** Clear the refusal once it has been read. */
  clearError: () => void;
  onTogglePlan: (enabled: boolean) => void;
  /** The Goal modal's outcome. Opening the modal is the TOOLBAR's business
   *  (the modal itself lives in `ChatInput`), so that handler is passed
   *  separately and does not belong to the shared mode shape.
   *
   *  Resolves with the outcome: the modal closes on `ok` and keeps the form
   *  otherwise, so a refusal can be read and retried. */
  onGoalAction: (action: GoalAction) => Promise<GoalActionResult>;
}
