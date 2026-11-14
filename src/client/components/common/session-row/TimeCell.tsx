/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * A session row's timestamp cell, in one place for all three rows.
 *
 * Two readings of the same question, never both at once:
 *
 *   - at rest, the row's age (`now`, `5m`, `3 Mar`);
 *   - while its run is live, a clock counting from the server's start.
 *
 * The caller owns the column's classes because the three rows size it
 * differently (10px mono on the desktop rows, 11px in the phone's drawer, and
 * a hover-fade variant in the modern row's trailing slot).
 */

import { RunElapsed } from '@/client/components/common/session-row/RunElapsed';

export interface SessionTimeCellProps {
  /** Relative age of the session, or null when no usable timestamp exists. */
  timeAgo?: string | null;
  /** Full timestamp shown as the age's hover tooltip. */
  timeTitle?: string | null;
  /** Epoch ms the row's live run started; the cell counts instead of aging. */
  runStartedAt?: number;
  /** The row's trailing-column classes for the rendered node. */
  className: string;
}

export function SessionTimeCell({ timeAgo, timeTitle, runStartedAt, className }: SessionTimeCellProps) {
  if (runStartedAt !== undefined) {
    return <RunElapsed startedAt={runStartedAt} className={className} />;
  }
  if (!timeAgo) return null;
  return <span className={className} title={timeTitle ?? undefined}>{timeAgo}</span>;
}
