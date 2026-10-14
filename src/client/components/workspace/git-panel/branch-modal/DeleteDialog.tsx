import { AlertTriangle } from 'lucide-preact';
import { Modal } from '@/client/components/common/Modal';
import type { GitBranchDetail } from '@/shared/types/git';

interface DeleteBranchDialogProps {
  /** The branch being deleted; `null` renders nothing. */
  branch: GitBranchDetail | null;
  /** Run `-D` instead of `-d` — only ever set by the user, after `-d` refused. */
  force: boolean;
  onForceChange: (value: boolean) => void;
  onClose: () => void;
  onConfirm: (name: string) => void;
}

/**
 * Delete a branch, as a TWO-STEP decision.
 *
 * `git branch -d` refuses a branch whose commits are not merged (`error: the
 * branch 'feat' is not fully merged` — measured) and `-D` forces. That refusal
 * is git telling the user that deleting this branch loses commits, so it is the
 * safety net — and the panel's first attempt is always `-d`. The force checkbox
 * is the explicit second step, and it is worded as what it costs rather than as
 * "force": a label that says `-D` invites the click without reading.
 *
 * Nothing is pre-checked, and nothing auto-forces on a refusal: the panel's
 * toast carries git's own sentence, and the user comes back and ticks the box.
 * This is the one action in the panel whose only undo is the reflog.
 */
export function DeleteBranchDialog({
  branch,
  force,
  onForceChange,
  onClose,
  onConfirm,
}: DeleteBranchDialogProps) {
  if (!branch) return null;

  return (
    <Modal
      onClose={onClose}
      maxWidthClass="max-w-[min(94vw,440px)]"
      header={
        <div className="flex items-center gap-2">
          <AlertTriangle size={15} className="text-error flex-shrink-0" />
          <h2 className="text-sm font-semibold text-ink">Delete branch</h2>
        </div>
      }
    >
      <div className="px-5 py-4 flex flex-col gap-3 text-xs text-ink/80 leading-relaxed">
        <p>
          Delete <span className="font-mono font-semibold text-ink">{branch.name}</span>
          {branch.upstream && (
            <>
              {' '}(tracks <span className="font-mono">{branch.upstream}</span>)
            </>
          )}
          ?
        </p>

        <div className="text-[10px] font-mono text-ink/60 border border-ink/10 rounded p-2 bg-canvas/40 flex flex-col gap-0.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-ink/40">last commit</span>
            <span className="truncate">{branch.subject || '—'}</span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-ink/40">when</span>
            <span>{branch.date || '—'}</span>
          </div>
        </div>

        <label className="flex items-start gap-2 cursor-pointer select-none text-[11px]">
          <input
            type="checkbox"
            checked={force}
            onChange={(e) => onForceChange(e.currentTarget.checked)}
            className="accent-error cursor-pointer mt-0.5"
          />
          <span className="flex flex-col gap-0.5">
            <span className="text-error font-medium">Delete even if its commits are not merged</span>
            <span className="text-[10px] font-mono text-ink/50">
              git branch {force ? '-D' : '-d'} {branch.name}
            </span>
            <span className="text-ink/50">
              Without this, git refuses when the branch holds commits no other branch has. Leaving it off is the safe
              default.
            </span>
          </span>
        </label>
      </div>

      <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-ink/10">
        <button
          type="button"
          onClick={onClose}
          className="px-3 py-1.5 rounded border border-ink/20 text-ink/70 hover:bg-ink/5 hover:text-ink transition-colors cursor-pointer text-xs"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => onConfirm(branch.name)}
          className="px-3 py-1.5 rounded bg-error text-canvas hover:bg-error/90 transition-colors cursor-pointer text-xs font-medium"
        >
          Delete {force ? '(force)' : ''}
        </button>
      </div>
    </Modal>
  );
}
