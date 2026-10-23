/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The Files panel's ROW context menu: everything a right-click on a file or a
 * folder can ask for.
 *
 * Split out of `Modals.tsx` (which keeps the four dialogs) because the row list
 * grew a second axis — the clipboard — and the menu is now data rather than
 * markup: `buildRows` decides which rows exist and in what order, and the
 * component only draws them. That is also what makes the height exact. The
 * clamp at the viewport's bottom edge needs the menu's real height, and the
 * hand-written constants it used to carry were wrong the moment a row was
 * added — an under-estimate puts the last rows (Delete included) off-screen
 * with no way to reach them.
 *
 * Three rules the row table encodes:
 *  - **Paste names what it will paste.** `Paste notes.md` is the only place the
 *    clipboard's content is visible, and the clipboard is not a second window
 *    the user can look at.
 *  - **Paste is absent, not disabled, where it cannot land** — the root, a
 *    folder inside the copied folder's own subtree, another workspace. A row
 *    that is always there and always refuses is a row that reads as broken.
 *  - **Cut/Copy/Duplicate/Delete are all disabled while a transfer runs**, so a
 *    second click cannot start a transfer against a tree that is mid-change.
 */

import { createPortal } from 'preact/compat';
import type { ReactNode, RefObject } from 'preact/compat';
import { ClipboardPaste, Copy, CopyPlus, Edit2, ExternalLink, Eye, FilePlus, FolderPlus, GitCompare, History, Scissors, Trash2 } from 'lucide-preact';

interface ContextMenuProps {
  x: number;
  y: number;
  isFolder: boolean;
  hasGitStatus?: boolean;
  /** Label of the Paste row, or null when a paste cannot land on this target. */
  pasteLabel: string | null;
  /** True while a transfer is in flight; the acting rows disable on it. */
  busy: boolean;
  onAction: (actionType: string) => void;
  menuRef?: RefObject<HTMLDivElement>;
}

/** One drawable menu entry: a row, or the divider between two groups. */
type MenuEntry =
  | { kind: 'separator' }
  | { kind: 'item'; id: string; label: string; icon: ReactNode; tone?: string; disabled?: boolean };

/** Row and divider metrics, used for both the drawing and the height clamp. */
const ROW_PX = 28;
const SEPARATOR_PX = 9;
const PADDING_PX = 8;

/** The rows this target offers, in order — the menu's single source of truth. */
function buildRows(options: { isFolder: boolean; hasGitStatus?: boolean; pasteLabel: string | null; busy: boolean }): MenuEntry[] {
  const { isFolder, hasGitStatus, pasteLabel, busy } = options;
  const entries: MenuEntry[] = [];

  if (isFolder) {
    entries.push({ kind: 'item', id: 'new_file', label: 'New File', icon: <FilePlus size={13} className="text-ink/60" /> });
    entries.push({ kind: 'item', id: 'new_folder', label: 'New Folder', icon: <FolderPlus size={13} className="text-ink/60" /> });
    entries.push({ kind: 'separator' });
  } else {
    entries.push({ kind: 'item', id: 'view', label: 'View', icon: <Eye size={13} className="text-ink/60" /> });
    if (hasGitStatus) {
      entries.push({ kind: 'item', id: 'diff', label: 'Open in Diff Panel', icon: <GitCompare size={13} className="text-warning" />, tone: 'font-medium' });
    }
    entries.push({ kind: 'separator' });
  }

  entries.push({ kind: 'item', id: 'cut', label: 'Cut', icon: <Scissors size={13} className="text-ink/60" />, disabled: busy });
  entries.push({ kind: 'item', id: 'copy', label: 'Copy', icon: <Copy size={13} className="text-ink/60" />, disabled: busy });
  entries.push({ kind: 'item', id: 'duplicate', label: 'Duplicate', icon: <CopyPlus size={13} className="text-ink/60" />, disabled: busy });
  if (pasteLabel) {
    entries.push({ kind: 'item', id: 'paste', label: pasteLabel, icon: <ClipboardPaste size={13} className="text-ink/60" />, disabled: busy });
  }
  entries.push({ kind: 'separator' });

  entries.push({ kind: 'item', id: 'explorer', label: 'Go to Explorer', icon: <ExternalLink size={13} className="text-ink/60" /> });
  entries.push({ kind: 'item', id: 'copy_path', label: 'Copy Path', icon: <Copy size={13} className="text-ink/60" /> });
  entries.push({ kind: 'item', id: 'copy_relative', label: 'Copy Relative Path', icon: <Copy size={13} className="text-ink/60" /> });
  entries.push({ kind: 'separator' });

  entries.push({ kind: 'item', id: 'history', label: 'Show Git History', icon: <History size={13} className="text-ink/60" /> });
  entries.push({ kind: 'separator' });

  entries.push({ kind: 'item', id: 'rename', label: 'Rename', icon: <Edit2 size={13} className="text-ink/60" /> });
  entries.push({ kind: 'item', id: 'delete', label: 'Delete', icon: <Trash2 size={13} className="text-error" />, tone: 'text-error' });

  return entries;
}

/** Height of a row list, so the clamp cannot drift from what is drawn. */
function menuHeightOf(entries: MenuEntry[]): number {
  const items = entries.filter((entry) => entry.kind === 'item').length;
  const separators = entries.length - items;
  return items * ROW_PX + separators * SEPARATOR_PX + PADDING_PX;
}

export function FileContextMenu({ x, y, isFolder, hasGitStatus, pasteLabel, busy, onAction, menuRef }: ContextMenuProps) {
  const menuWidth = 190;
  const entries = buildRows({ isFolder, hasGitStatus, pasteLabel, busy });
  const menuHeight = menuHeightOf(entries);

  const posX = typeof window !== 'undefined' ? Math.max(10, Math.min(x, window.innerWidth - menuWidth - 12)) : x;
  const posY = typeof window !== 'undefined' ? Math.max(10, Math.min(y, window.innerHeight - menuHeight - 12)) : y;

  return createPortal(
    <div
      className="fixed inset-0 z-50 bg-ink/20"
      onClick={() => onAction('close')}
      onContextMenu={(e) => { e.preventDefault(); onAction('close'); }}
    >
      <div
        ref={menuRef}
        className="fixed z-50 bg-paper border border-ink/15 shadow-2xl rounded-lg py-1 min-w-[185px] text-xs text-ink font-sans"
        style={{ top: posY, left: posX }}
        onClick={e => e.stopPropagation()}
      >
        {entries.map((entry, index) => entry.kind === 'separator' ? (
          <div key={`sep-${index}`} className="my-1 border-t border-ink/10"></div>
        ) : (
          <button
            key={entry.id}
            type="button"
            disabled={entry.disabled}
            onClick={() => onAction(entry.id)}
            className={`w-full text-left px-3 py-1.5 flex items-center space-x-2 transition-colors ${
              entry.disabled ? 'opacity-40 cursor-default' : 'hover:bg-ink/5'
            } ${entry.tone ?? ''}`}
          >
            {entry.icon}
            <span>{entry.label}</span>
          </button>
        ))}
      </div>
    </div>,
    document.body
  );
}
