/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * WHICH CHECKOUT of the workspace the chat runs in: the project root, or one of
 * its git worktrees.
 *
 * Its own control, not a group inside the workspace picker. The two answer
 * different questions — which project, and which checkout of it — and the merged
 * menu made both harder: a user looking for another project scrolled through
 * branch names, and the worktree rows had no trigger of their own to be found
 * from. OpenChamber's composer draws the same pair, and its worktree `Select`
 * carries the branch label on the trigger, which is what this one does too.
 *
 * The control is ABSENT for a workspace that is not a git repository: there is
 * nothing to pick and nothing to create, so a permanently disabled control in
 * every notes folder would be noise. `isRepo` comes from the list payload, so
 * the decision is the server's, not a guess from the folder's shape.
 *
 * The pick is `{folderId, worktreePath}`; the folder is what the workspace
 * picker chose, and this control only ever moves the second half.
 */

import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { AlertTriangle, Check, ChevronDown, GitBranch } from 'lucide-preact';
import { useOnClickOutside } from '@/client/hooks/ui/on-click-outside';
import { createWorktree, useWorktrees } from '@/client/hooks/workspace/worktree/index';
import { NewWorktreeModal } from '@/client/components/workspace/worktree-modal/index';
import type { SpawnTarget } from '@/client/hooks/chat/timeline/spawn-target';
import type { WorktreeInfo } from '@/shared/lib/workspace/worktree/types';
import { lastPathSegment } from '@/shared/lib/fs/paths';
import type { WorkspaceFolderData } from '@/shared/types';

export interface WorktreePickerProps {
  folders: WorkspaceFolderData[];
  selectedFolderId: number | null;
  target: SpawnTarget | null;
  setTarget: (next: SpawnTarget | null) => void;
  /** Reports a completed create, or the refusal that stopped one. */
  onReport?: (message: string) => void;
}

/** The worktree row the pick names, or null for the project root. */
export function selectedWorktree(worktrees: WorktreeInfo[], target: SpawnTarget | null): WorktreeInfo | null {
  if (!target?.worktreePath) return null;
  return worktrees.find((worktree) => worktree.path === target.worktreePath) ?? null;
}

/**
 * The trigger's words: the branch of the checkout the chat will run in.
 *
 * The project root is named by the branch it holds rather than by the word
 * "root", which is what OpenChamber shows and what a reader needs: the root of a
 * repository sitting on `main` and one sitting on `wt/scratch` are different
 * places to start a chat. `Project root` remains the fallback for a payload that
 * has not arrived, or a repository git cannot read a branch from.
 */
export function worktreeLabel(worktrees: WorktreeInfo[], target: SpawnTarget | null): string {
  const picked = selectedWorktree(worktrees, target);
  if (target?.worktreePath) {
    if (!picked) return lastPathSegment(target.worktreePath) || 'Worktree';
    return picked.branch || (picked.detached ? 'detached' : lastPathSegment(picked.path) || 'Worktree');
  }
  const primary = worktrees.find((worktree) => worktree.isPrimary);
  return primary?.branch || 'Project root';
}

export function WorktreePicker({ folders, selectedFolderId, target, setTarget, onReport }: WorktreePickerProps) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  useOnClickOutside(containerRef, () => setOpen(false));

  const folder = folders.find((candidate) => String(candidate.id) === String(selectedFolderId)) ?? null;
  const scopeRoot = folder?.project_path ?? null;
  const folderId = folder ? Number(folder.id) : null;

  // Read on MOUNT, not only on open: the trigger's own label is the branch the
  // project root holds, and whether this control exists at all is the payload's
  // `isRepo`. Measured cost of the read on this repository: ~150 ms, one spawn
  // per worktree for its dirty count.
  const { worktrees, isRepo, error, refresh } = useWorktrees(
    { root: scopeRoot, folderId },
    Boolean(scopeRoot),
  );

  // Re-read when the menu opens, so a worktree made in another tab or by the
  // dialog is in the list the user is looking at.
  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  // A pick is cleared by the WORKSPACE picker's own choice, never by an effect
  // comparing `target.folderId` with the selected folder: on a reload the target
  // is restored from the session's UI state a beat before the folder resolves,
  // and a mismatch check in that window wiped the very pick it was protecting.

  const list = useMemo(() => worktrees.filter((worktree) => !worktree.isPrimary), [worktrees]);
  const picked = selectedWorktree(worktrees, target);
  const primary = worktrees.find((worktree) => worktree.isPrimary) ?? null;
  const dirty = (picked ?? primary)?.dirty ?? 0;

  const pickRoot = () => {
    if (folderId !== null) setTarget({ folderId, worktreePath: null });
    setOpen(false);
  };

  const pickWorktree = (worktreePath: string) => {
    if (folderId !== null) setTarget({ folderId, worktreePath });
    setOpen(false);
  };

  /**
   * Quick worktree: a generated branch and folder, created and selected without
   * leaving the draft. Reported rather than silent — the create takes a moment
   * and a pick that changed with no word reads as a mis-click.
   */
  const quickWorktree = async () => {
    if (!scopeRoot || folderId === null) return;
    setCreating(true);
    try {
      const created = await createWorktree({ root: scopeRoot, folderId }, { mode: 'new' });
      pickWorktree(created.path);
      onReport?.(`Worktree ${created.branch || lastPathSegment(created.path)} created`);
    } catch (failure) {
      onReport?.(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setCreating(false);
    }
  };

  // Not a repository (or not read yet): no control at all. Rendering one that
  // can only refuse would promise a worktree a plain folder cannot hold.
  if (!scopeRoot || isRepo !== true) return null;

  return (
    <div className="relative shrink-0" ref={containerRef}>
      <button
        type="button"
        aria-label={`Worktree: ${worktreeLabel(worktrees, target)}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="group flex items-center space-x-1.5 px-1.5 py-1 rounded-md text-xs font-medium text-ink/75 hover:text-ink hover:bg-ink/5 focus-visible:bg-ink/5 transition-all outline-none cursor-pointer select-none"
      >
        {dirty > 0 ? (
          <AlertTriangle
            size={13}
            className="text-warning flex-shrink-0"
            aria-label={`${dirty} uncommitted file${dirty === 1 ? '' : 's'} in this checkout`}
          />
        ) : (
          <GitBranch size={13} className="text-ink/50 group-hover:text-ink/80 transition-colors flex-shrink-0" />
        )}
        <span className="max-w-[240px] truncate tracking-tight">{worktreeLabel(worktrees, target)}</span>
        <ChevronDown
          size={13}
          className={`text-ink/40 group-hover:text-ink/70 flex-shrink-0 transition-transform duration-150 ${open ? 'rotate-180 text-ink/70' : ''}`}
        />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute bottom-full left-0 mb-1.5 w-72 bg-paper border border-ink/10 rounded-lg shadow-lg z-50 flex flex-col overflow-hidden text-xs py-1"
        >
          <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-ink/40 font-semibold border-b border-ink/5">
            Project root
          </div>
          <button
            type="button"
            role="menuitemradio"
            aria-checked={!target?.worktreePath}
            onClick={pickRoot}
            title={primary?.path ?? scopeRoot}
            className={`w-full text-left px-3 py-1.5 flex items-center justify-between transition-colors cursor-pointer ${
              !target?.worktreePath ? 'bg-ink/10 text-ink font-semibold' : 'text-ink/80 hover:bg-ink/5 hover:text-ink'
            }`}
          >
            <span className="flex items-center gap-2 truncate pr-2">
              <GitBranch size={12} className="text-ink/50 flex-shrink-0" />
              <span className="truncate font-medium">{primary?.branch || folder?.name || 'Project root'}</span>
              {primary && primary.dirty > 0 && (
                <span className="text-ink/40 shrink-0" title={`${primary.dirty} uncommitted files`}>
                  ●{primary.dirty}
                </span>
              )}
            </span>
            {!target?.worktreePath && <Check size={12} className="text-ink flex-shrink-0" />}
          </button>

          {/* Making one comes before the list, so a long list never hides it. */}
          <div className="my-1 border-t border-ink/5" />
          <button
            type="button"
            role="menuitem"
            disabled={creating}
            onClick={() => void quickWorktree()}
            className="w-full text-left px-3 py-1.5 flex items-center gap-2 text-ink/80 hover:bg-ink/5 hover:text-ink disabled:opacity-50"
          >
            <span aria-hidden="true">⚡</span>
            {creating ? 'Creating…' : 'Quick worktree'}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              setDialogOpen(true);
            }}
            className="w-full text-left px-3 py-1.5 flex items-center gap-2 text-ink/80 hover:bg-ink/5 hover:text-ink"
          >
            <GitBranch size={12} className="text-ink/50" />
            New worktree…
          </button>

          <div className="my-1 border-t border-ink/5" />
          <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-ink/40 font-semibold">Worktrees</div>
          <div className="max-h-56 scrollbar-overlay-container py-1">
            {list.length === 0 ? (
              <div className="px-3 py-2 text-ink/40 italic">
                {error ? 'Worktrees could not be read' : 'No worktrees yet'}
              </div>
            ) : (
              list.map((worktree) => {
                const active = target?.worktreePath === worktree.path;
                return (
                  <button
                    key={worktree.path}
                    type="button"
                    role="menuitemradio"
                    aria-checked={active}
                    onClick={() => pickWorktree(worktree.path)}
                    title={worktree.path}
                    className={`w-full text-left px-3 py-1.5 flex items-center justify-between transition-colors cursor-pointer ${
                      active ? 'bg-ink/10 text-ink font-semibold' : 'text-ink/80 hover:bg-ink/5 hover:text-ink'
                    }`}
                  >
                    <span className="flex items-center gap-2 truncate pr-2">
                      <GitBranch size={12} className="text-ink/50 flex-shrink-0" />
                      <span className="truncate font-medium">{worktree.branch || 'detached'}</span>
                      {worktree.missing && <span className="text-warning shrink-0">missing</span>}
                      {worktree.dirty > 0 && (
                        <span className="text-ink/40 shrink-0" title={`${worktree.dirty} uncommitted files`}>
                          ●{worktree.dirty}
                        </span>
                      )}
                    </span>
                    {active && <Check size={12} className="text-ink flex-shrink-0" />}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}

      <NewWorktreeModal
        isOpen={dialogOpen}
        onClose={() => setDialogOpen(false)}
        root={scopeRoot}
        folderId={folderId}
        folderName={folder?.name}
        onCreated={(created) => {
          pickWorktree(created.path);
          onReport?.(`Worktree ${created.branch} created`);
        }}
      />
    </div>
  );
}
