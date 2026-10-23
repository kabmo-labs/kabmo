/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Where a chat that has not started will run: the workspace, or one of the
 * workspace's worktrees.
 *
 * One control rather than two, because both answers are the same question. The
 * menu is grouped exactly as OpenChamber's draft target is — the project root
 * first, then the two ways to make a worktree, then the worktrees that already
 * exist — and creating one here means the user does not have to leave the draft
 * to get it.
 *
 * The pick is `{folderId, worktreePath}`: choosing a folder CLEARS the worktree
 * (the groups are mutually exclusive), while choosing a worktree keeps its
 * folder, so the row the composer draws can always name both.
 */

import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Check, ChevronDown, Folder, GitBranch } from 'lucide-preact';
import { useOnClickOutside } from '@/client/hooks/ui/on-click-outside';
import { useWorktrees } from '@/client/hooks/workspace/worktree/index';
import type { SpawnTarget } from '@/client/hooks/chat/timeline/spawn-target';
import { NewWorktreeModal } from '@/client/components/workspace/worktree-modal/index';
import { createWorktree } from '@/client/hooks/workspace/worktree/index';
import { lastPathSegment } from '@/shared/lib/fs/paths';
import type { WorkspaceFolderData } from '@/shared/types';

export interface TargetPickerProps {
  folders: WorkspaceFolderData[];
  selectedFolderId: number | null;
  setSelectedFolderId: (id: number | null) => void;
  target: SpawnTarget | null;
  setTarget: (next: SpawnTarget | null) => void;
  /**
   * Reports a completed create/removal to the caller (a toast). Optional: the
   * picker owns the flows, so a caller that only wants the pick needs nothing.
   */
  onReport?: (message: string) => void;
}

/** The trigger's words: the folder, plus the worktree when one is picked. */
export function targetLabel(
  folders: WorkspaceFolderData[],
  selectedFolderId: number | null,
  target: SpawnTarget | null,
): string {
  const folder = folders.find((candidate) => String(candidate.id) === String(selectedFolderId));
  const name = folder?.name ?? 'Select Workspace Context';
  const worktree = lastPathSegment(target?.worktreePath);
  return worktree ? `${name} · ${worktree}` : name;
}

export function TargetPicker({
  folders,
  selectedFolderId,
  setSelectedFolderId,
  target,
  setTarget,
  onReport,
}: TargetPickerProps) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [dialogFolder, setDialogFolder] = useState<WorkspaceFolderData | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  useOnClickOutside(containerRef, () => setOpen(false));

  const selectedFolder = folders.find((candidate) => String(candidate.id) === String(selectedFolderId)) ?? null;
  const scopeRoot = selectedFolder?.project_path ?? null;

  // The list is read only while the menu is open: it costs a `git status` per
  // worktree, and a closed picker must never pay for it.
  const { worktrees, error, refresh } = useWorktrees(
    { root: scopeRoot, folderId: selectedFolder?.id ?? null },
    open && Boolean(scopeRoot),
  );
  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  const list = useMemo(() => worktrees.filter((worktree) => !worktree.isPrimary), [worktrees]);

  const pickFolder = (folder: WorkspaceFolderData) => {
    setSelectedFolderId(folder.id);
    // A folder and a worktree are alternative answers, not a pair.
    setTarget(null);
    setOpen(false);
  };

  const pickWorktree = (folder: WorkspaceFolderData, worktreePath: string) => {
    setSelectedFolderId(folder.id);
    setTarget({ folderId: Number(folder.id), worktreePath });
    setOpen(false);
  };

  /**
   * Quick worktree: a generated branch and folder, created and selected without
   * leaving the draft. Reported rather than silent — the create takes a moment
   * and a pick that changed with no word reads as a mis-click.
   */
  const quickWorktree = async (folder: WorkspaceFolderData) => {
    if (!folder.project_path) return;
    setCreating(true);
    try {
      const created = await createWorktree(
        { root: folder.project_path, folderId: folder.id },
        { mode: 'new' },
      );
      pickWorktree(folder, created.path);
      onReport?.(`Worktree ${created.branch || lastPathSegment(created.path)} created`);
    } catch (error) {
      onReport?.(error instanceof Error ? error.message : String(error));
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="relative shrink-0" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="group flex items-center space-x-1.5 px-1.5 py-1 rounded-md text-xs font-medium text-ink/75 hover:text-ink hover:bg-ink/5 focus-visible:bg-ink/5 transition-all outline-none cursor-pointer select-none"
      >
        {target?.worktreePath ? (
          <GitBranch size={13} className="text-ink/50 group-hover:text-ink/80 transition-colors flex-shrink-0" />
        ) : (
          <Folder size={13} className="text-ink/50 group-hover:text-ink/80 transition-colors flex-shrink-0" />
        )}
        <span className="flex items-center space-x-1 max-w-[260px] truncate tracking-tight">
          <span>{targetLabel(folders, selectedFolderId, target)}</span>
        </span>
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
          <div className="max-h-56 scrollbar-overlay-container py-1">
            {folders.length === 0 ? (
              <div className="px-3 py-2 text-ink/40 italic">No workspaces available</div>
            ) : (
              folders.map((folder) => (
                <button
                  key={folder.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={selectedFolderId === folder.id && !target?.worktreePath}
                  onClick={() => pickFolder(folder)}
                  className={`w-full text-left px-3 py-1.5 flex items-center justify-between transition-colors cursor-pointer ${
                    selectedFolderId === folder.id && !target?.worktreePath
                      ? 'bg-ink/10 text-ink font-semibold'
                      : 'text-ink/80 hover:bg-ink/5 hover:text-ink'
                  }`}
                >
                  <span className="flex items-center space-x-2 truncate pr-2">
                    <Folder size={12} className={selectedFolderId === folder.id ? 'text-ink flex-shrink-0' : 'text-ink/50 flex-shrink-0'} />
                    <span className="truncate font-medium">{folder.name}</span>
                  </span>
                  {selectedFolderId === folder.id && !target?.worktreePath && <Check size={12} className="text-ink flex-shrink-0" />}
                </button>
              ))
            )}
          </div>

          {/* Making one comes before the list, so a long list never hides it. */}
          {selectedFolder && scopeRoot && (
            <>
              <div className="border-t border-ink/5 px-3 py-1.5 text-[10px] uppercase tracking-wider text-ink/40 font-semibold">
                Worktrees
              </div>
              <button
                type="button"
                role="menuitem"
                disabled={creating}
                onClick={() => void quickWorktree(selectedFolder)}
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
                  setDialogFolder(selectedFolder);
                }}
                className="w-full text-left px-3 py-1.5 flex items-center gap-2 text-ink/80 hover:bg-ink/5 hover:text-ink"
              >
                <GitBranch size={12} className="text-ink/50" />
                New worktree…
              </button>
              <div className="max-h-56 scrollbar-overlay-container py-1">
                {list.length === 0 ? (
                  <div className="px-3 py-2 text-ink/40 italic">
                    {error ? 'Worktrees could not be read' : 'No worktrees yet'}
                  </div>
                ) : (
                  list.map((worktree) => (
                    <button
                      key={worktree.path}
                      type="button"
                      role="menuitemradio"
                      aria-checked={target?.worktreePath === worktree.path}
                      onClick={() => pickWorktree(selectedFolder, worktree.path)}
                      title={worktree.path}
                      className={`w-full text-left px-3 py-1.5 flex items-center justify-between transition-colors cursor-pointer ${
                        target?.worktreePath === worktree.path
                          ? 'bg-ink/10 text-ink font-semibold'
                          : 'text-ink/80 hover:bg-ink/5 hover:text-ink'
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
                      {target?.worktreePath === worktree.path && <Check size={12} className="text-ink flex-shrink-0" />}
                    </button>
                  ))
                )}
              </div>
            </>
          )}
        </div>
      )}

      <NewWorktreeModal
        isOpen={dialogFolder !== null}
        onClose={() => setDialogFolder(null)}
        root={dialogFolder?.project_path ?? null}
        folderId={dialogFolder ? Number(dialogFolder.id) : null}
        folderName={dialogFolder?.name}
        onCreated={(created) => {
          if (!dialogFolder) return;
          pickWorktree(dialogFolder, created.path);
          onReport?.(`Worktree ${created.branch} created`);
        }}
      />
    </div>
  );
}