/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The in-flow line an updating harness row carries: what the background worker
 * is doing — or that it is still waiting its turn — and the way into its log.
 *
 * It is a LINE under the row rather than a second icon in the action cell,
 * because that cell is a fixed `1.75rem` track measured for one 24px button —
 * two of them overflow it, which is the same defect the earlier `7rem` track
 * caused in the other direction. In flow it can also carry the step's name,
 * which a bare icon cannot.
 *
 * **Waiting is a state of its own.** Two presses are one install at a time: the
 * second harness's record carries `queuedAt`, and a line that said "Updating…"
 * there would claim an install that has not started. It says what it is waiting
 * for, because the queue is invisible otherwise.
 *
 * After the run settles the line stays, showing what happened and keeping
 * `View log` available: the failure case is exactly when the output matters. A
 * settled line also carries the dismiss control — the record is history, and
 * without a way out "claude updated (adapter) — it now reports 0.106.0" stayed
 * on the row forever. A running or queued line has no dismiss: deleting a live
 * record would hide the spinner and let a second install start.
 */

import { X } from 'lucide-preact';

export interface UpdateLogLineProps {
  /** Is the worker still installing? */
  running: boolean;
  /** Is this run waiting for the install ahead of it? */
  queued?: boolean;
  /** The step it is on (`adapter`, `Claude Code`, …), when the record says. */
  progress: string | null;
  /** The finished run's sentence, once it has one. */
  message: string | null;
  onOpenLog?: () => void;
  /** Drops the settled record. Absent while the run is still moving. */
  onDismiss?: () => void;
}

export function UpdateLogLine({ running, queued = false, progress, message, onOpenLog, onDismiss }: UpdateLogLineProps) {
  const settled = !running && !queued;
  return (
    <span className="col-span-3 flex items-center gap-2 pb-1 text-[10px] text-ink/60">
      {running
        ? <span>{progress ? `Installing ${progress}…` : 'Updating…'}</span>
        : queued
          ? <span>Queued — starts when the install running now finishes</span>
          : <span className="min-w-0 truncate">{message ?? 'Update finished'}</span>}
      <button
        type="button"
        data-update-log
        onClick={() => onOpenLog?.()}
        className="shrink-0 cursor-pointer font-medium text-ink underline decoration-ink/30 underline-offset-2 transition-colors hover:decoration-ink"
      >
        View log
      </button>
      {settled && onDismiss && (
        <button
          type="button"
          data-update-dismiss
          onClick={onDismiss}
          aria-label="Dismiss update result"
          title="Dismiss"
          className="ml-auto shrink-0 cursor-pointer rounded p-0.5 text-ink/40 transition-colors hover:bg-ink/5 hover:text-ink"
        >
          <X size={10} className="stroke-[2.5]" />
        </button>
      )}
    </span>
  );
}
