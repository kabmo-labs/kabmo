import { AlertTriangle, GitMerge, Undo2 } from 'lucide-preact';
import type { GitOperation } from '@/shared/types/git';
import { OPERATION_LABELS } from '@/shared/lib/fs/git-unmerged';

interface GitOperationBarProps {
  operation: GitOperation;
  /** Repo-relative paths still unmerged. */
  conflicts: string[];
  isBusy: boolean;
  onAbort: () => void;
  onContinue: () => void;
}

/**
 * The bar that replaces the commit box while a git operation is stopped.
 *
 * This is the whole reason the panel models an operation at all: it is the only
 * thing on screen that says "you are in the middle of something", it carries
 * the two actions that exist ONLY in that state (abort, continue), and it turns
 * the conflict count into a number the user can drive to zero. Before it, the
 * commit box answered `Committing is not possible because you have unmerged
 * files` and a merge was indistinguishable from an ordinary dirty tree.
 *
 * **Continue is enabled only when no conflicted path remains**, because git
 * refuses the concluding commit otherwise and that refusal reads as a panel
 * bug. The button is not hidden — a disabled button with the count beside it is
 * what tells the user how much is left.
 *
 * **A `stash-pop` shows NO Continue button at all.** It is the one conflict
 * state with no sequencer to conclude: resolving its files leaves the changes
 * in the working tree, and the server refuses a `continue` for it (a `commit`
 * there would create one the user never asked for). Offering a button whose
 * only outcome is a refusal is worse than not offering it — the bar says what
 * is left (resolve, then the changes are yours) and offers Abort to discard
 * them.
 */
export function GitOperationBar({ operation, conflicts, isBusy, onAbort, onContinue }: GitOperationBarProps) {
  const label = OPERATION_LABELS[operation];
  const pending = conflicts.length;
  const ready = pending === 0;
  const canContinue = operation !== 'stash-pop';

  return (
    <div className="border-t border-warning/30 bg-warning/5 p-3 flex flex-col gap-2">
      <div className="flex items-center gap-2 text-xs text-ink">
        <AlertTriangle size={13} className="text-warning flex-shrink-0" />
        <span className="font-medium">
          {label.charAt(0).toUpperCase() + label.slice(1)} in progress
        </span>
        <span className={`font-mono tabular-nums text-[10px] ${ready ? 'text-success' : 'text-warning'}`}>
          {ready ? 'all conflicts resolved' : `${pending} conflict${pending === 1 ? '' : 's'} left`}
        </span>
      </div>

      {!ready && (
        <div className="max-h-20 overflow-y-auto scrollbar-overlay-container scrollbar-overlay-static font-mono text-[10px] text-warning/90 space-y-0.5">
          {conflicts.map((file) => (
            <div key={file} className="truncate" title={file}>
              {file}
            </div>
          ))}
        </div>
      )}

      <div className="flex items-stretch gap-2">
        <button
          type="button"
          onClick={onAbort}
          disabled={isBusy}
          title={`Abort the ${label} and restore the previous state`}
          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded border border-error/40 text-error hover:bg-error/10 transition-colors cursor-pointer text-xs font-medium disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Undo2 size={12} />
          Abort {label}
        </button>
        {/* `border border-transparent` so this button is the same box as Abort:
            Abort carries a 1px border, so without one here the two measured
            30px vs 28px tall and sat 1px apart — the pair read as misaligned.
            `items-stretch` then makes them share whatever height that is. */}
        {canContinue && (
          <button
            type="button"
            onClick={onContinue}
            disabled={isBusy || !ready}
            title={ready ? `Conclude the ${label}` : `Resolve all ${pending} conflict(s) first`}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded border border-transparent bg-ink text-canvas hover:bg-ink/90 transition-colors cursor-pointer text-xs font-medium disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <GitMerge size={12} />
            Continue {label}
          </button>
        )}
      </div>
    </div>
  );
}
