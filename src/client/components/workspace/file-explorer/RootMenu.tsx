/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The Files panel's ROOT context menu: the one shown by a right-click on the
 * panel's own background rather than on a row.
 *
 * A row's menu (`FileContextMenu`) offers View, Diff, Rename, Delete — all
 * things a FILE has. The root has none of them: it is the listing itself, and
 * the only things you can ask of it are a new file or folder at the top of the
 * tree and a paste into it. Reusing the row menu here would have offered six
 * actions that name the wrong target.
 *
 * Paste is the one row-menu action the root DOES own: pasting into the
 * background means pasting into the root folder, which is a real destination —
 * and it is the only way to move an entry back out of a folder once it is in
 * one, because a drag is not offered.
 */

import { createPortal } from 'preact/compat';
import type { RefObject } from 'preact/compat';
import { ClipboardPaste, FilePlus, FolderPlus } from 'lucide-preact';

interface RootContextMenuProps {
  x: number;
  y: number;
  /** Label of the Paste row, or null when there is nothing to paste. */
  pasteLabel: string | null;
  /** True while a transfer is in flight; the acting rows disable on it. */
  busy: boolean;
  onAction: (actionType: string) => void;
  menuRef?: RefObject<HTMLDivElement>;
}

export function RootContextMenu({ x, y, pasteLabel, busy, onAction, menuRef }: RootContextMenuProps) {
  const menuWidth = 190;
  // Two create rows, plus paste when the clipboard can land here.
  const menuHeight = pasteLabel ? 104 : 76;

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
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={() => onAction('new_file')}
          className="w-full text-left px-3 py-1.5 hover:bg-ink/5 flex items-center space-x-2 transition-colors"
        >
          <FilePlus size={13} className="text-ink/60" />
          <span>New File</span>
        </button>
        <button
          type="button"
          onClick={() => onAction('new_folder')}
          className="w-full text-left px-3 py-1.5 hover:bg-ink/5 flex items-center space-x-2 transition-colors"
        >
          <FolderPlus size={13} className="text-ink/60" />
          <span>New Folder</span>
        </button>
        {pasteLabel && (
          <button
            type="button"
            disabled={busy}
            onClick={() => onAction('paste')}
            className={`w-full text-left px-3 py-1.5 flex items-center space-x-2 transition-colors ${
              busy ? 'opacity-40 cursor-default' : 'hover:bg-ink/5'
            }`}
          >
            <ClipboardPaste size={13} className="text-ink/60" />
            <span>{pasteLabel}</span>
          </button>
        )}
      </div>
    </div>,
    document.body,
  );
}
