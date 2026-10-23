/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A workspace's header row in the desktop sidebar: the disclosure mark, the
 * folder's name, its two actions, and — while a batch selection is active — the
 * checkbox that selects it (workspace mode) or all of its rows (session mode).
 *
 * Split out of `CategoryItem` because the row now has two modes' worth of
 * markup and the parent is also the list. The checkbox rules stay in the parent
 * (they are about the selection, not the drawing) and arrive as `checkbox`
 * props; this file only decides how the two states look.
 */

import { useState } from 'preact/hooks';
import { ChevronDown, ChevronRight, MoreHorizontal, Pin, Plus } from 'lucide-preact';
import { NewWorktreeModal } from '@/client/components/workspace/worktree-modal/index';
import { SelectionCheckbox } from '@/client/components/common/batch-selection/SelectionCheckbox';
import { WorkspaceOptionsMenu } from '@/client/components/common/workspace-options-menu';
import { getProjectIcon } from '@/shared/lib/workspace/project-icon';
import type { WorkspaceFolderData } from '@/shared/types';

export interface CategoryHeaderCheckbox {
  checked: boolean;
  indeterminate: boolean;
  label: string;
  onChange: () => void;
}

export interface CategoryHeaderProps {
  folder: WorkspaceFolderData;
  isOpen: boolean;
  onToggleFolder: () => void;
  /** Null when this workspace is not part of the active selection. */
  checkbox: CategoryHeaderCheckbox | null;
  /** True while a batch selection is active — actions are hidden then. */
  batchActive: boolean;
  menuRef: { current: HTMLDivElement | null };
  showMenu: boolean;
  onToggleMenu: () => void;
  onNewSession: () => void;
  /** Start a chat in a worktree made from this folder. */
  onNewWorktreeSession?: (folderId: number, worktreePath: string) => void;
  onOpenFolder?: () => void;
  onSelectSessions?: () => void;
  confirmDelete: boolean;
  onPin: () => void;
  onDelete: () => void;
  onRequestDelete: () => void;
  onCancelDelete: () => void;
}

export function CategoryHeader({
  folder,
  isOpen,
  onToggleFolder,
  checkbox,
  batchActive,
  menuRef,
  showMenu,
  onToggleMenu,
  onNewSession,
  onNewWorktreeSession,
  onOpenFolder,
  onSelectSessions,
  confirmDelete,
  onPin,
  onDelete,
  onRequestDelete,
  onCancelDelete,
}: CategoryHeaderProps) {
  const ProjectIcon = getProjectIcon(folder.icon);
  // The dialog lives here rather than in the page: the row that opens it is this
  // one, and the folder it belongs to is what the dialog needs.
  const [worktreeDialogOpen, setWorktreeDialogOpen] = useState(false);
  const canCreateWorktree = Boolean(onNewWorktreeSession && folder.project_path);

  return (
    <div className="group flex items-center justify-between h-7 text-xs font-semibold text-ink px-2 hover:bg-ink/5 rounded-md transition-colors select-none">
      <div
        className="flex-1 h-full flex items-center cursor-pointer min-w-0"
        onClick={batchActive ? undefined : onToggleFolder}
      >
        {checkbox ? (
          <>
            <SelectionCheckbox
              size="md"
              checked={checkbox.checked}
              indeterminate={checkbox.indeterminate}
              label={checkbox.label}
              onChange={checkbox.onChange}
            />
            <span className="w-2 shrink-0" />
          </>
        ) : (
          <>
            {/* One 16px slot owns both glyphs, exactly like a session row's
                status/chevron slot: the folder mark sits there at rest and hands
                the slot to the disclosure chevron on hover, so the icon column
                reads as one line AND the header says what clicking it does. */}
            <span className="relative w-4 h-4 flex items-center justify-center shrink-0">
              <span className="absolute inset-0 flex items-center justify-center transition-opacity group-hover:opacity-0 touch-hidden">
                {folder.customIconUrl ? (
                  <img
                    src={folder.customIconUrl}
                    alt=""
                    className="w-[15px] h-[15px] rounded-xs object-contain shrink-0"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <ProjectIcon
                    size={15}
                    className="text-ink/75"
                    style={{ color: folder.accentColor || undefined }}
                  />
                )}
              </span>
              <span className="absolute inset-0 flex items-center justify-center text-ink/60 opacity-0 transition-opacity group-hover:opacity-100 touch-visible">
                {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              </span>
            </span>
            <span className="w-2 shrink-0" />
          </>
        )}
        {folder.isPinned && <Pin size={11} className="text-ink/60 shrink-0 mr-1.5" />}
        <span className="truncate text-[13px] font-semibold tracking-tight">{folder.name}</span>
      </div>

      {/* Workspace Actions — always drawn, matching the drawer's folder header.
          They used to appear only on hover, which left the folder's own
          affordances undiscoverable in a sidebar that has no other cue. In
          batch mode they are hidden: the row is a choice, and an action beside
          a checkbox is a second thing the click could mean. */}
      {!batchActive && (
        <div className="flex items-center space-x-0.5 pl-1">
          {/* `aria-label` as well as `title`, like the phone's row: the button
              is icon-only, so `title` alone leaves it unnamed to assistive tech
              and to `getByRole` — and naming the FOLDER is what tells this
              button apart from the toolbar's own New Session, which inherits
              the current session's folder instead of naming one. */}
          <button
            type="button"
            title="New Session"
            aria-label={`New session in ${folder.name}`}
            className="w-5 h-5 flex items-center justify-center text-ink/40 hover:text-ink hover:bg-ink/10 rounded cursor-pointer transition-colors"
            onClick={(e) => { e.stopPropagation(); onNewSession(); }}
          >
            <Plus size={12} />
          </button>

          <div className="relative flex items-center" ref={menuRef}>
            <button
              type="button"
              title={`Options for ${folder.name}`}
              aria-label={`Options for ${folder.name}`}
              className="w-5 h-5 flex items-center justify-center text-ink/40 hover:text-ink hover:bg-ink/10 rounded cursor-pointer transition-colors"
              onClick={(e) => { e.stopPropagation(); onToggleMenu(); }}
            >
              <MoreHorizontal size={12} />
            </button>

            {showMenu && (
              <div className="absolute right-0 top-full mt-1 w-44 bg-paper border border-ink/15 rounded-md shadow-lg z-50 py-1 text-xs">
                <WorkspaceOptionsMenu
                  variant="desktop"
                  isPinned={folder.isPinned}
                  onOpenFolder={onOpenFolder}
                  onSelectSessions={onSelectSessions}
                  onNewWorktree={canCreateWorktree ? () => { onToggleMenu(); setWorktreeDialogOpen(true); } : undefined}
                  confirmDelete={confirmDelete}
                  onPin={onPin}
                  onDelete={onDelete}
                  onRequestDelete={onRequestDelete}
                  onCancelDelete={onCancelDelete}
                />
              </div>
            )}
          </div>
        </div>
      )}

      {canCreateWorktree && (
        <NewWorktreeModal
          isOpen={worktreeDialogOpen}
          onClose={() => setWorktreeDialogOpen(false)}
          root={folder.project_path ?? null}
          folderId={folder.id}
          folderName={folder.name}
          onCreated={(created) => {
            setWorktreeDialogOpen(false);
            onNewWorktreeSession?.(folder.id, created.path);
          }}
        />
      )}
    </div>
  );
}
