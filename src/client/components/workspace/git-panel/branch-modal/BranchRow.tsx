import { Check, GitBranch, GitMerge, Pencil, Trash2 } from 'lucide-preact';
import type { GitBranchDetail } from '@/shared/types/git';

interface BranchRowProps {
  branch: GitBranchDetail;
  detached: boolean;
  onCheckout: () => void;
  onMerge: () => void;
  onRename: () => void;
  onDelete: () => void;
}

/**
 * One branch row: the name, its tracking state, and its actions.
 *
 * **Laid out as a GRID, not a flex row, and that is what makes the columns
 * straight.** The previous shape was `flex items-center` with the right side a
 * `flex-col items-end` stack (badge over date). A row carrying a subject is two
 * lines tall while its right stack is two SHORT lines, so centering put the
 * badge at a different y in every row — the badge and the date never lined up
 * with the rows above and below. Measured on the real modal: a one-line row put
 * the badge 5px lower than a two-line row did.
 *
 * The fix is a fixed track list plus `items-start`, with every non-name cell
 * pinned to ONE first-line height (`h-5`): the name, the tracking state, the
 * date and the actions all start at the same y in every row, and only the
 * subject hangs below the name. The columns are also fixed WIDTHS so their
 * edges line up too, not just their baselines — an auto-width cell moves every
 * row's left edge to wherever that row's text happens to end.
 *
 * **The tracking column is the row's whole value, and its hardest case is the
 * EMPTY one.** Measured, `%(upstream:track)` is empty for a branch with no
 * upstream — including a branch several commits ahead of everything — so an
 * empty track must read "unpublished", never "in sync". `[gone]` is its own
 * case: the upstream ref was deleted on the remote, which is what a remote
 * rename without `--prune` leaves behind.
 *
 * **Rename and Delete are hidden on the checked-out branch.** git refuses to
 * delete a branch that is checked out, and renaming the branch you are on is
 * the one rename whose consequences (every other worktree, every open editor's
 * notion of the branch) are not visible from this dialog. Checkout is hidden on
 * it too — it is a no-op, and a button that does nothing reads as broken.
 */
export function BranchRow({ branch, detached, onCheckout, onMerge, onRename, onDelete }: BranchRowProps) {
  const isCurrent = branch.current && !detached;

  return (
    // The track list is the column contract: 1rem check, the name takes what is
    // left, then fixed tracking / date / actions tracks. `items-start` plus the
    // per-cell `h-5` is what keeps the first line of every column on one y.
    <div className="grid grid-cols-[1rem_minmax(0,1fr)_minmax(0,9.5rem)_4.25rem_4rem] items-start gap-x-2 px-4 py-2 border-b border-ink/5 last:border-b-0 hover:bg-ink/[0.02] group/row transition-colors">
      <div className="h-5 flex items-center justify-center">
        {isCurrent && <Check size={12} className="text-ink" aria-label="Current branch" />}
      </div>

      <button
        type="button"
        onClick={onCheckout}
        disabled={isCurrent}
        title={isCurrent ? 'Already on this branch' : `Check out ${branch.name}`}
        className="min-w-0 text-left cursor-pointer disabled:cursor-default"
      >
        <div className="h-5 flex items-center gap-1.5 min-w-0">
          <GitBranch size={11} className={isCurrent ? 'text-ink/60 flex-shrink-0' : 'text-ink/40 flex-shrink-0'} />
          <span className={`truncate text-xs ${isCurrent ? 'font-semibold text-ink' : 'text-ink/90'}`}>
            {branch.name}
          </span>
        </div>
        {branch.subject && (
          <div className="h-4 flex items-center pl-[18px] min-w-0">
            <span className="truncate text-[10px] text-ink/40" title={branch.subject}>
              {branch.subject}
            </span>
          </div>
        )}
      </button>

      <div className="h-5 flex items-center justify-end min-w-0">
        <TrackingBadge branch={branch} />
      </div>

      <div className="h-5 flex items-center justify-end">
        {branch.date && <span className="text-[9px] text-ink/40 truncate">{branch.date}</span>}
      </div>

      <div className="h-5 flex items-center justify-end gap-0.5 touch-visible opacity-0 group-hover/row:opacity-100">
        {!isCurrent && (
          <button
            type="button"
            onClick={onMerge}
            title={`Merge ${branch.name} into the current branch`}
            aria-label={`Merge ${branch.name} into the current branch`}
            className="w-5 h-5 flex items-center justify-center rounded text-ink/40 hover:text-ink hover:bg-ink/10 cursor-pointer transition-colors"
          >
            <GitMerge size={11} />
          </button>
        )}
        <button
          type="button"
          onClick={onRename}
          title={`Rename ${branch.name}`}
          aria-label={`Rename ${branch.name}`}
          className="w-5 h-5 flex items-center justify-center rounded text-ink/40 hover:text-ink hover:bg-ink/10 cursor-pointer transition-colors"
        >
          <Pencil size={11} />
        </button>
        {!isCurrent && (
          <button
            type="button"
            onClick={onDelete}
            title={`Delete ${branch.name}`}
            aria-label={`Delete ${branch.name}`}
            className="w-5 h-5 flex items-center justify-center rounded text-ink/40 hover:text-error hover:bg-error/10 cursor-pointer transition-colors"
          >
            <Trash2 size={11} />
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * The upstream column: the tracking state, in the four forms it takes.
 *
 * Right-aligned against the date column so its own right edge is straight, and
 * truncated rather than wrapped — a wrapped badge would make the row taller
 * than its neighbours and undo the alignment the grid exists for.
 */
function TrackingBadge({ branch }: { branch: GitBranchDetail }) {
  if (branch.gone) {
    return (
      <span
        className="text-[9px] font-mono text-warning border border-warning/30 rounded px-1 truncate"
        title={`${branch.upstream} no longer exists on the remote — fetch --prune to drop it`}
      >
        gone
      </span>
    );
  }

  if (!branch.upstream) {
    // Not "in sync": there is nothing to be in sync WITH. This is the row a
    // fresh `git checkout -b` produces, and reporting ↑0 ↓0 would hide
    // unpushed commits.
    return (
      <span className="text-[9px] font-mono text-ink/40 truncate" title="No upstream — this branch has never been published">
        unpublished
      </span>
    );
  }

  return (
    <span className="flex items-center gap-1 text-[9px] font-mono text-ink/50 min-w-0">
      <span className="truncate" title={branch.upstream}>{branch.upstream}</span>
      {(branch.ahead > 0 || branch.behind > 0) && (
        <span className="tabular-nums text-ink/70 flex-shrink-0">
          {branch.ahead > 0 && `↑${branch.ahead}`}
          {branch.behind > 0 && `↓${branch.behind}`}
        </span>
      )}
    </span>
  );
}
