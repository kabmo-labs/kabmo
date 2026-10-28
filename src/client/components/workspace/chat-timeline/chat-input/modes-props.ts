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
import type { GoalAction } from '@/client/hooks/chat/timeline/modes';

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
  pending: boolean;
  /** Plan is hidden while Goal is on: omp refuses to enter one mode while the
   *  other is active, so offering both would present a button whose only
   *  outcome is a refusal. */
  planAvailable: boolean;
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
   *  separately and does not belong to the shared mode shape. */
  onGoalAction: (action: GoalAction) => void;
}
