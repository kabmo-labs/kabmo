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
 * The caller owns the column's LAYOUT classes because the three rows size it
 * differently (10px mono on the desktop rows, 11px in the phone's drawer, and
 * a hover-fade variant in the modern row's trailing slot). The TONE is this
 * cell's: the live clock is the row's signal and reads brighter than the age
 * it replaces, and a second `text-ink/NN` in the caller's string would race
 * this one in the stylesheet instead of overriding it.
 */

import { RunElapsed } from '@/client/components/common/session-row/RunElapsed';

/** The age at rest — the dimmest reading the rows share. */
const RESTING_TONE = 'text-ink/40';
/** The live clock: same ink, brighter, so a running row is scannable. */
const RUNNING_TONE = 'text-ink/80';

export interface SessionTimeCellProps {
  /** Relative age of the session, or null when no usable timestamp exists. */
  timeAgo?: string | null;
  /** Full timestamp shown as the age's hover tooltip. */
  timeTitle?: string | null;
  /** Epoch ms the row's live run started; the cell counts instead of aging. */
  runStartedAt?: number;
  /** The row's trailing-column layout classes for the rendered node. */
  className: string;
  /** Override the resting tone where a chrome dims the age further. */
  restingClassName?: string;
}

export function SessionTimeCell({
  timeAgo,
  timeTitle,
  runStartedAt,
  className,
  restingClassName = RESTING_TONE,
}: SessionTimeCellProps) {
  if (runStartedAt !== undefined) {
    return <RunElapsed startedAt={runStartedAt} className={`${className} ${RUNNING_TONE}`} />;
  }
  if (!timeAgo) return null;
  return <span className={`${className} ${restingClassName}`} title={timeTitle ?? undefined}>{timeAgo}</span>;
}
