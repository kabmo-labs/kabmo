import { useState } from 'preact/hooks';
import { Modal } from '@/client/components/common/Modal';
import type { GitBranchDetail } from '@/shared/types/git';

interface RenameBranchDialogProps {
  /** The branch being renamed; `null` renders nothing. */
  branch: GitBranchDetail | null;
  onClose: () => void;
  onSubmit: (from: string, to: string, remote: boolean) => void;
}

/**
 * Rename a branch, locally and optionally on the remote.
 *
 * **The upstream is kept as-is by `git branch -m`, and the dialog says so.**
 * Measured: after `git branch -m feature feat2` the config still reads
 * `branch.feat2.merge = refs/heads/feature`, so the branch keeps tracking
 * `origin/feature` — and a plain `git push` afterwards REFUSES outright
 * (`fatal: The upstream branch of your current branch does not match the name of
 * your current branch`). Showing the current upstream before the rename is what
 * turns that from a surprise into a decision.
 *
 * **The remote half is a checkbox, OFF by default, and it names the three
 * commands it will run.** Renaming a local branch is cheap and reversible;
 * rewriting what everyone else has checked out is not, and the remote half can
 * be refused by the server (`remote: error: By default, deleting the current
 * branch is denied`). Default-off is the conservative option.
 *
 * The name is validated against git's own grammar
 * (`git check-ref-format --branch`) by the server on submit — this dialog only
 * refuses the empty case and the unchanged case, because a client-side
 * reimplementation of that grammar is a second thing to keep in step.
 *
 * **The form is initialized by MOUNTING it fresh, never by a reset effect.**
 * The previous shape kept one mounted dialog and cleared its fields in a
 * `useEffect` keyed on the branch. Preact runs effects AFTER paint, so the
 * field was on screen and focusable before the reset landed, and a keystroke in
 * that window was discarded — measured in the browser: `fill('feature-renamed')`
 * left the field reading `feature`, because the effect re-ran (the parent
 * re-renders as the branch list reloads) and put the OLD name back. `if
 * (!branch) return null` plus a `key` on the caller's side means there is no
 * ordering question to get wrong.
 */
export function RenameBranchDialog({ branch, onClose, onSubmit }: RenameBranchDialogProps) {
  if (!branch) return null;
  return <RenameBranchForm branch={branch} onClose={onClose} onSubmit={onSubmit} />;
}

function RenameBranchForm({
  branch,
  onClose,
  onSubmit,
}: {
  branch: GitBranchDetail;
  onClose: () => void;
  onSubmit: (from: string, to: string, remote: boolean) => void;
}) {
  // Seeded from the prop at mount; the component is remounted (via the caller's
  // `key`) whenever the branch changes, so no effect has to keep them in step.
  const [name, setName] = useState(branch.name);
  const [remote, setRemote] = useState(false);

  const trimmed = name.trim();
  const unchanged = trimmed === branch.name;
  const canSubmit = trimmed.length > 0 && !unchanged;

  const submit = () => {
    if (canSubmit) onSubmit(branch.name, trimmed, remote);
  };

  return (
    <Modal
      onClose={onClose}
      maxWidthClass="max-w-[min(94vw,460px)]"
      header={
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-ink">Rename branch</h2>
          <span className="text-[10px] font-mono text-ink/50 truncate">{branch.name}</span>
        </div>
      }
    >
      <div className="px-5 py-4 flex flex-col gap-3">
        <div>
          <label className="text-[10px] uppercase tracking-wider text-ink/50 font-semibold" htmlFor="branch-rename-input">
            New name
          </label>
          <input
            id="branch-rename-input"
            type="text"
            value={name}
            autoFocus
            onChange={(e) => setName(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit();
              if (e.key === 'Escape') onClose();
            }}
            className="mt-1 w-full bg-paper border border-ink/20 rounded px-2.5 py-1.5 text-xs font-mono text-ink focus:outline-none focus:border-ink/40 transition-colors"
          />
          {unchanged && trimmed.length > 0 && (
            <p className="mt-1 text-[10px] text-ink/50">The name is unchanged.</p>
          )}
        </div>

        <div className="text-[10px] font-mono text-ink/60 flex flex-col gap-0.5 border border-ink/10 rounded p-2 bg-canvas/40">
          <div className="flex items-center justify-between gap-2">
            <span className="text-ink/40">upstream</span>
            <span className="truncate">{branch.upstream || 'none (unpublished)'}</span>
          </div>
          <p className="text-ink/40 leading-relaxed mt-0.5">
            A local rename keeps this upstream unchanged — a plain push afterwards will refuse until the upstream
            matches the new name, which is what the remote option below does.
          </p>
        </div>

        <label className="flex items-start gap-2 text-[11px] text-ink/80 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={remote}
            onChange={(e) => setRemote(e.currentTarget.checked)}
            className="accent-ink cursor-pointer mt-0.5"
          />
          <span className="flex flex-col gap-0.5">
            <span>Also rename it on the remote</span>
            <span className="text-[10px] font-mono text-ink/50">
              git push -u {branch.upstream ? branch.upstream.split('/')[0] : 'origin'} {trimmed || '<new>'}
              <br />
              git push {branch.upstream ? branch.upstream.split('/')[0] : 'origin'} --delete {branch.name}
              <br />
              git fetch --prune
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
          onClick={submit}
          disabled={!canSubmit}
          className="px-3 py-1.5 rounded bg-ink text-canvas hover:bg-ink/90 transition-colors cursor-pointer text-xs font-medium disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Rename
        </button>
      </div>
    </Modal>
  );
}
