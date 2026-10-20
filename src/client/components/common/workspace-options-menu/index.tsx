/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Workspace options menu body shared by the desktop category header and the
 * mobile category item: pin/unpin, delete, and the inline delete confirmation.
 *
 * Only the body is shared — each sidebar owns its own absolutely-positioned
 * container (different widths, radii, and padding) and its trigger button, so
 * the two shells stay pixel-identical while the actions and labels have one
 * source of truth.
 */

import { FolderOpen, ListChecks, Pin, PinOff, Trash2 } from 'lucide-preact';

interface WorkspaceOptionsMenuProps {
  variant: 'desktop' | 'mobile';
  isPinned?: boolean;
  /** Reveal the workspace directory in the platform file manager. Omitted for
   *  an unbound folder, which has no directory of its own. */
  onOpenFolder?: () => void;
  /** Enter the session batch-selection mode scoped to this workspace. */
  onSelectSessions?: () => void;
  confirmDelete: boolean;
  onPin: () => void;
  onDelete: () => void;
  onRequestDelete: () => void;
  onCancelDelete: () => void;
}

export function WorkspaceOptionsMenu({
  variant,
  isPinned = false,
  onOpenFolder,
  onSelectSessions,
  confirmDelete,
  onPin,
  onDelete,
  onRequestDelete,
  onCancelDelete,
}: WorkspaceOptionsMenuProps) {
  if (variant === 'mobile') {
    return confirmDelete ? (
      <>
        <div className="px-3 py-2 text-ink/80 font-medium">Delete workspace?</div>
        <button type="button" onClick={onDelete} className="w-full text-left px-3 py-2 hover:bg-error/10 text-error flex items-center space-x-2">
          <Trash2 size={13} />
          <span>Yes, delete</span>
        </button>
        <button type="button" onClick={onCancelDelete} className="w-full text-left px-3 py-2 hover:bg-ink/5 text-ink/70">
          Cancel
        </button>
      </>
    ) : (
      <>
        {onOpenFolder && (
          <button type="button" onClick={onOpenFolder} className="w-full text-left px-3 py-2 hover:bg-ink/5 text-ink/80 flex items-center space-x-2">
            <FolderOpen size={13} />
            <span>Go to Explorer</span>
          </button>
        )}
        <button type="button" onClick={onPin} className="w-full text-left px-3 py-2 hover:bg-ink/5 text-ink/80 flex items-center space-x-2">
          {isPinned ? <PinOff size={13} /> : <Pin size={13} />}
          <span>{isPinned ? 'Unpin Workspace' : 'Pin Workspace'}</span>
        </button>
        {onSelectSessions && (
          <button type="button" onClick={onSelectSessions} className="w-full text-left px-3 py-2 hover:bg-ink/5 text-ink/80 flex items-center space-x-2">
            <ListChecks size={13} />
            <span>Select sessions</span>
          </button>
        )}
        <button type="button" onClick={onRequestDelete} className="w-full text-left px-3 py-2 hover:bg-error/10 text-error flex items-center space-x-2">
          <Trash2 size={13} />
          <span>Delete Workspace</span>
        </button>
      </>
    );
  }

  return confirmDelete ? (
    <>
      <div className="px-3 py-1.5 text-xs text-ink/80 font-medium">Delete workspace?</div>
      <button type="button" onClick={onDelete} className="w-full text-left px-3 py-1.5 hover:bg-ink/5 cursor-pointer flex items-center space-x-2 text-error">
        <Trash2 size={12} /><span>Yes, delete</span>
      </button>
      <button type="button" onClick={onCancelDelete} className="w-full text-left px-3 py-1.5 hover:bg-ink/5 cursor-pointer flex items-center space-x-2 text-ink/70">
        <span>Cancel</span>
      </button>
    </>
  ) : (
    <>
      {onOpenFolder && (
        <button type="button" onClick={onOpenFolder} className="w-full text-left px-3 py-1.5 hover:bg-ink/5 cursor-pointer flex items-center space-x-2 text-ink/80">
          <FolderOpen size={12} /><span>Go to Explorer</span>
        </button>
      )}
      <button type="button" onClick={onPin} className="w-full text-left px-3 py-1.5 hover:bg-ink/5 cursor-pointer flex items-center space-x-2 text-ink/80">
        {isPinned ? <PinOff size={12} /> : <Pin size={12} />}
        <span>{isPinned ? 'Unpin Workspace' : 'Pin Workspace'}</span>
      </button>
      {onSelectSessions && (
        <button type="button" onClick={onSelectSessions} className="w-full text-left px-3 py-1.5 hover:bg-ink/5 cursor-pointer flex items-center space-x-2 text-ink/80">
          <ListChecks size={12} /><span>Select sessions</span>
        </button>
      )}
      <button type="button" onClick={onRequestDelete} className="w-full text-left px-3 py-1.5 hover:bg-ink/5 cursor-pointer flex items-center space-x-2 text-error">
        <Trash2 size={12} /><span>Delete Workspace</span>
      </button>
    </>
  );
}
