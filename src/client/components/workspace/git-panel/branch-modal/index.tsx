import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Loader2, RefreshCw, Search } from 'lucide-preact';
import type { GitBranchDetail } from '@/shared/types/git';
import { Modal } from '@/client/components/common/Modal';
import { BranchRow } from '@/client/components/workspace/git-panel/branch-modal/BranchRow';
import { RenameBranchDialog } from '@/client/components/workspace/git-panel/branch-modal/RenameDialog';
import { DeleteBranchDialog } from '@/client/components/workspace/git-panel/branch-modal/DeleteDialog';

interface GitBranchModalProps {
  isOpen: boolean;
  rootPath?: string;
  repo: string;
  /** The checked-out branch, for the header and for disabling self-actions. */
  currentBranch: string;
  detached: boolean;
  /**
   * A panel action is in flight. The list re-reads when this flips back to
   * false — the one moment an action dispatched from this dialog can have
   * landed. Without it the modal kept rendering the branch list it fetched on
   * open, so a rename looked like it had done nothing until the dialog was
   * closed and reopened (verified in the browser: the rename was on disk and
   * the list still showed the old name).
   */
  isBusy: boolean;
  onClose: () => void;
  /** Runs `checkout` / `merge_branch` / `rename_branch` / `delete_branch`. */
  onAction: (actionType: string, extra?: Record<string, string>) => void;
  /** Opens the panel's confirm modal for a delete. */
  onConfirmDelete: (name: string, force: boolean) => void;
}

/**
 * The branch management modal, opened from the branch dropdown.
 *
 * The dropdown could not host this: it is 224px wide with a 192px scroll area
 * and one `<button>` per branch, which stops working at the scale branches
 * actually reach (measured: `for-each-ref` over 501 branches is 0.03s, but 501
 * buttons in a 192px panel is not a list). It also cannot carry per-branch
 * actions — the row's click is already checkout — and a row that both checks
 * out and merges is a row whose click means two things.
 *
 * Follows the commit modal's shell (`lg:w-[min(96vw,980px)] lg:h-[88vh]`,
 * full-screen on phones), so this is a sibling of an existing surface rather
 * than a new convention.
 *
 * **Everything the row shows comes from ONE read** (`?branches=1`, a single
 * `for-each-ref` with the upstream/ahead-behind/date/subject fields), fetched
 * when the modal opens. It is deliberately not on the status payload: that read
 * is on the realtime topic and republished on every tool call, and this list is
 * opened by hand.
 *
 * **Branch creation is NOT here.** It already exists in the dropdown
 * (`create_branch`) and in the commit modal (`create_branch_at`), and a third
 * entry point would be a third place for the same validation to drift.
 */
export function GitBranchModal({
  isOpen,
  rootPath,
  repo,
  currentBranch,
  detached,
  isBusy,
  onClose,
  onAction,
  onConfirmDelete,
}: GitBranchModalProps) {
  const [branches, setBranches] = useState<GitBranchDetail[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [renaming, setRenaming] = useState<GitBranchDetail | null>(null);
  const [deleting, setDeleting] = useState<GitBranchDetail | null>(null);
  const [forceDelete, setForceDelete] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    const params = new URLSearchParams({ branches: '1', repo: repo || '.' });
    if (rootPath) params.set('root', rootPath);
    try {
      const res = await fetch(`/api/fs/git?${params.toString()}`);
      const body = await res.json() as { success?: boolean; branches?: GitBranchDetail[]; error?: string };
      if (body.success && Array.isArray(body.branches)) setBranches(body.branches);
      else setError(body.error || `Failed to read branches (HTTP ${res.status})`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to read branches');
    } finally {
      setIsLoading(false);
    }
  }, [rootPath, repo]);

  useEffect(() => {
    if (isOpen) void load();
  }, [isOpen, load]);

  /**
   * Re-read after an action this dialog dispatched settles.
   *
   * A rename, a delete or a merge changes the list, and the dialog owns no
   * other signal for it: the panel's `isBusy` dropping back to false is the one
   * moment an action can have landed. Without this the list kept rendering
   * what it fetched on open — verified in the browser, the rename was on disk
   * while the row still showed the old name.
   *
   * The first pass is skipped (`wasBusy` starts false) so opening the dialog
   * does not fire a second read on top of the one above.
   */
  const wasBusyRef = useRef(false);
  useEffect(() => {
    if (!isOpen) {
      wasBusyRef.current = false;
      return;
    }
    if (wasBusyRef.current && !isBusy) void load();
    wasBusyRef.current = isBusy;
  }, [isOpen, isBusy, load]);

  // A closed modal keeps no stale dialogs: reopening on a different repo would
  // otherwise offer to rename a branch that is not there.
  useEffect(() => {
    if (!isOpen) {
      setRenaming(null);
      setDeleting(null);
      setForceDelete(false);
      setQuery('');
    }
  }, [isOpen]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return branches;
    return branches.filter((b) => b.name.toLowerCase().includes(q) || b.upstream.toLowerCase().includes(q));
  }, [branches, query]);

  if (!isOpen) return null;

  return (
    <>
      <Modal
        onClose={onClose}
        maxWidthClass="max-w-[min(96vw,720px)]"
        header={
          <div className="flex items-center gap-2 min-w-0">
            <h2 className="text-sm font-semibold text-ink">Branches</h2>
            <span className="text-[10px] font-mono text-ink/50">
              {detached ? `detached at ${currentBranch}` : `on ${currentBranch}`}
            </span>
          </div>
        }
      >
        <div className="px-5 py-3 flex items-center gap-2 border-b border-ink/10">
          <Search size={12} className="text-ink/40 flex-shrink-0" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
            placeholder="Filter branches…"
            aria-label="Filter branches"
            className="flex-1 min-w-0 bg-transparent outline-none text-xs text-ink placeholder-ink/40"
            autoFocus
          />
          <button
            type="button"
            onClick={() => void load()}
            disabled={isLoading}
            title="Refresh"
            aria-label="Refresh branches"
            className="text-ink/40 hover:text-ink transition-colors cursor-pointer disabled:opacity-40 flex-shrink-0"
          >
            <RefreshCw size={12} className={isLoading ? 'animate-spin' : ''} />
          </button>
        </div>

        <div className="min-h-[40vh] max-h-[60vh] overflow-y-auto scrollbar-overlay-container scrollbar-overlay-static">
          {isLoading && branches.length === 0 ? (
            <div className="flex items-center justify-center gap-2 py-12 text-xs text-ink/50 font-mono">
              <Loader2 size={14} className="animate-spin text-info" />
              Loading branches…
            </div>
          ) : error ? (
            <div className="py-12 px-6 text-center text-xs text-error font-mono">{error}</div>
          ) : filtered.length === 0 ? (
            <div className="py-12 text-center text-xs text-ink/40 font-mono">
              {query.trim() ? 'No matching branches.' : 'No branches.'}
            </div>
          ) : (
            filtered.map((b) => (
              <BranchRow
                key={b.name}
                branch={b}
                detached={detached}
                onCheckout={() => { onAction('checkout', { branch: b.name }); onClose(); }}
                onMerge={() => { onAction('merge_branch', { branch: b.name }); onClose(); }}
                onRename={() => setRenaming(b)}
                onDelete={() => { setDeleting(b); setForceDelete(false); }}
              />
            ))
          )}
        </div>
      </Modal>

      <RenameBranchDialog
        // The `key` is what remounts the form when a DIFFERENT branch is
        // renamed, so the field is seeded from that branch at mount instead of
        // being reset by an effect after paint (which is what discarded a
        // keystroke typed in the gap).
        key={renaming?.name ?? 'none'}
        branch={renaming}
        onClose={() => setRenaming(null)}
        onSubmit={(from, to, remote) => {
          onAction('rename_branch', { branch: from, newName: to, ...(remote ? { remote: '1' } : {}) });
          setRenaming(null);
        }}
      />

      <DeleteBranchDialog
        branch={deleting}
        force={forceDelete}
        onForceChange={setForceDelete}
        onClose={() => { setDeleting(null); setForceDelete(false); }}
        onConfirm={(name) => {
          onConfirmDelete(name, forceDelete);
          setDeleting(null);
          setForceDelete(false);
        }}
      />
    </>
  );
}
