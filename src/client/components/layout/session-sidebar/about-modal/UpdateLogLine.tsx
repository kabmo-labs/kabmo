/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The in-flow line an updating harness row carries: what the background worker
 * is doing, and the way into its log.
 *
 * It is a LINE under the row rather than a second icon in the action cell,
 * because that cell is a fixed `1.75rem` track measured for one 24px button —
 * two of them overflow it, which is the same defect the earlier `7rem` track
 * caused in the other direction. In flow it can also carry the step's name,
 * which a bare icon cannot.
 *
 * After the run settles the line stays, showing what happened and keeping
 * `View log` available: the failure case is exactly when the output matters, and
 * the record it lives in survives until the next update replaces it.
 */

export interface UpdateLogLineProps {
  /** Is the worker still installing? */
  running: boolean;
  /** The step it is on (`adapter`, `Claude Code`, …), when the record says. */
  progress: string | null;
  /** The finished run's sentence, once it has one. */
  message: string | null;
  onOpenLog?: () => void;
}

export function UpdateLogLine({ running, progress, message, onOpenLog }: UpdateLogLineProps) {
  return (
    <span className="col-span-3 flex items-center gap-2 pb-1 text-[10px] text-ink/60">
      {running
        ? <span>{progress ? `Installing ${progress}…` : 'Updating…'}</span>
        : <span className="min-w-0 truncate">{message ?? 'Update finished'}</span>}
      <button
        type="button"
        data-update-log
        onClick={() => onOpenLog?.()}
        className="shrink-0 cursor-pointer font-medium text-ink underline decoration-ink/30 underline-offset-2 transition-colors hover:decoration-ink"
      >
        View log
      </button>
    </span>
  );
}
