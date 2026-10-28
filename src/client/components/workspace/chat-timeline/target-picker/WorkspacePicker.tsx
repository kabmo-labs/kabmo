/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * WHERE the chat runs: the workspace folder.
 *
 * One control of the composer's draft-target pair, and the pair exists because
 * the two questions are different: the folder is the project, and the worktree
 * is the checkout inside it (`WorktreePicker`). They were merged into one menu
 * once, and the result read as a workspace picker with worktree rows buried in
 * it — a user looking for another project scrolled past branch names, and a
 * user looking for a worktree could not tell the control was the place to look.
 * OpenChamber draws them as two controls for the same reason.
 *
 * Picking a folder CLEARS the worktree pick: a checkout of the previous project
 * names a path that does not exist under the new one.
 */

import { useRef, useState } from 'preact/hooks';
import { Check, ChevronDown, Folder } from 'lucide-preact';
import { useOnClickOutside } from '@/client/hooks/ui/on-click-outside';
import type { WorkspaceFolderData } from '@/shared/types';

export interface WorkspacePickerProps {
  folders: WorkspaceFolderData[];
  selectedFolderId: number | null;
  setSelectedFolderId: (id: number | null) => void;
  /** Called with `null` when the user moves to another project. */
  onClearWorktree?: () => void;
}

/** The trigger's words, exported so a test asserts them without the markup. */
export function workspaceLabel(folders: WorkspaceFolderData[], selectedFolderId: number | null): string {
  const folder = folders.find((candidate) => String(candidate.id) === String(selectedFolderId));
  return folder?.name ?? 'Select Workspace Context';
}

export function WorkspacePicker({
  folders,
  selectedFolderId,
  setSelectedFolderId,
  onClearWorktree,
}: WorkspacePickerProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  useOnClickOutside(containerRef, () => setOpen(false));

  const pick = (folder: WorkspaceFolderData) => {
    setSelectedFolderId(folder.id);
    // A worktree belongs to the project it was made from; keeping the pick
    // across a project change would spawn the chat in a path this project
    // cannot resolve.
    onClearWorktree?.();
    setOpen(false);
  };

  const label = workspaceLabel(folders, selectedFolderId);

  return (
    <div className="relative shrink-0" ref={containerRef}>
      <button
        type="button"
        // Two triggers sit side by side, so each needs a name that says which
        // question it answers: "kabmo" and "main" alone are both ambiguous.
        aria-label={`Workspace: ${label}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="group flex items-center space-x-1.5 px-1.5 py-1 rounded-md text-xs font-medium text-ink/75 hover:text-ink hover:bg-ink/5 focus-visible:bg-ink/5 transition-all outline-none cursor-pointer select-none"
      >
        <Folder size={13} className="text-ink/50 group-hover:text-ink/80 transition-colors flex-shrink-0" />
        <span className="max-w-[260px] truncate tracking-tight">{label}</span>
        <ChevronDown
          size={13}
          className={`text-ink/40 group-hover:text-ink/70 flex-shrink-0 transition-transform duration-150 ${open ? 'rotate-180 text-ink/70' : ''}`}
        />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute bottom-full left-0 mb-1.5 w-64 bg-paper border border-ink/10 rounded-lg shadow-lg z-50 flex flex-col overflow-hidden text-xs py-1"
        >
          <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-ink/40 font-semibold border-b border-ink/5">
            Target Workspace
          </div>
          <div className="max-h-56 scrollbar-overlay-container py-1">
            {folders.length === 0 ? (
              <div className="px-3 py-2 text-ink/40 italic">No workspaces available</div>
            ) : (
              folders.map((folder) => {
                const active = String(selectedFolderId) === String(folder.id);
                return (
                  <button
                    key={folder.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={active}
                    onClick={() => pick(folder)}
                    className={`w-full text-left px-3 py-1.5 flex items-center justify-between transition-colors cursor-pointer ${
                      active ? 'bg-ink/10 text-ink font-semibold' : 'text-ink/80 hover:bg-ink/5 hover:text-ink'
                    }`}
                  >
                    <span className="flex items-center space-x-2 truncate pr-2">
                      <Folder size={12} className={active ? 'text-ink flex-shrink-0' : 'text-ink/50 flex-shrink-0'} />
                      <span className="truncate font-medium">{folder.name}</span>
                    </span>
                    {active && <Check size={12} className="text-ink flex-shrink-0" />}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
