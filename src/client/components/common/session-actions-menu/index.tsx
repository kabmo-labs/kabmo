/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * One overflow menu for a session row, shared by the desktop sidebar and the
 * mobile one.
 *
 * The row used to carry its actions as side-by-side hover icons (rename,
 * archive, delete). That does not scale: three icons cost roughly a third of
 * the title's width in the 268px sidebar, and every action added from here
 * takes another slice. One trigger whose contents grow is the shape that
 * survives the next action.
 *
 * Two ways in, one menu out:
 *   - the `⋯` button, which is the discoverable affordance;
 *   - a right-click anywhere on the row, which is the accelerator. Both are
 *     wired by the row component through `useRowMenu`.
 *
 * The menu positions itself from its OWN measured size. The item list is
 * conditional (a pending `new-…` chat has no Rename or Delete), so a constant
 * height would put the last row off-screen at the viewport edge — the same
 * class of bug the file explorer's context menu works around with hand-tuned
 * numbers.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { TargetedMouseEvent } from 'preact';
import { createPortal } from 'preact/compat';
import { Archive, ArchiveRestore, Hourglass, Pencil, Trash2, WandSparkles } from 'lucide-preact';

/** Viewport coordinates the menu hangs off, plus which edge it aligns to. */
export interface MenuAnchor {
  top: number;
  right: number;
  bottom: number;
  left: number;
  /**
   * `end` hangs the menu's right edge off the anchor's — what a row's overflow
   * button expects, since it sits at the row's end. `start` puts the menu's
   * left edge at the anchor's, so a context-menu click opens away from the
   * pointer rather than under it.
   */
  align: 'start' | 'end';
}

export interface RowMenuHandle {
  /** Non-null while the menu is open. */
  anchor: MenuAnchor | null;
  /** Open below the clicked element (the `⋯` button). */
  openBelow: (event: TargetedMouseEvent<HTMLElement>) => void;
  /** Open at the pointer (a right-click on the row). */
  openAtCursor: (event: TargetedMouseEvent<HTMLElement>) => void;
  close: () => void;
}

/** Anchor state for one row's overflow menu. */
export function useRowMenu(): RowMenuHandle {
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null);

  const openBelow = useCallback((event: TargetedMouseEvent<HTMLElement>) => {
    event.preventDefault();
    // The row underneath selects the session on click; opening its menu is not
    // a selection.
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    setAnchor({ top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left, align: 'end' });
  }, []);

  const openAtCursor = useCallback((event: TargetedMouseEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const { clientX, clientY } = event;
    setAnchor({ top: clientY, right: clientX, bottom: clientY, left: clientX, align: 'start' });
  }, []);

  const close = useCallback(() => setAnchor(null), []);

  return { anchor, openBelow, openAtCursor, close };
}

export interface SessionActionsMenuProps {
  anchor: MenuAnchor;
  isArchived?: boolean;
  /** Omitted when the row cannot be renamed (a pending `new-…` chat). */
  onRename?: () => void;
  /** Ask omp to name the session from its transcript. Omitted for a pending
   *  `new-…` chat, which has no transcript to derive a title from. */
  onRenameWithAi?: () => void;
  onArchive?: () => void;
  onDelete?: () => void;
  /**
   * Drop this row's held prompt (a `new-…` chat whose prompt is waiting on
   * another session). Omitted for every other row: a wait is the only state a
   * pending chat can cancel from here, and offering the item elsewhere would
   * promise an action with nothing behind it.
   */
  onCancelWait?: () => void;
  onClose: () => void;
}

export function SessionActionsMenu({
  anchor,
  isArchived = false,
  onRename,
  onRenameWithAi,
  onArchive,
  onDelete,
  onCancelWait,
  onClose,
}: SessionActionsMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const margin = 8;
    const below = anchor.bottom + 4;
    // Flip above the trigger rather than overflowing the bottom edge.
    const top = below + height + margin <= window.innerHeight
      ? below
      : Math.max(margin, anchor.top - height - 4);
    const desiredLeft = anchor.align === 'end' ? anchor.right - width : anchor.left;
    setPos({
      top,
      left: Math.max(margin, Math.min(desiredLeft, window.innerWidth - width - margin)),
    });
  }, [anchor]);

  useEffect(() => {
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  // Every item closes the menu first: Rename opens an inline editor in the row,
  // and leaving the menu over it would cover the input.
  const run = (action?: () => void) => () => {
    onClose();
    action?.();
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[70]"
      onClick={onClose}
      onContextMenu={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div
        ref={menuRef}
        role="menu"
        aria-label="Session actions"
        style={{
          top: pos?.top ?? anchor.bottom + 4,
          left: pos?.left ?? anchor.left,
          // Hidden for the single pre-measure render; `useLayoutEffect` settles
          // the position before the browser paints, so this never flashes.
          visibility: pos ? 'visible' : 'hidden',
        }}
        className="fixed z-[70] w-44 bg-paper border border-ink/15 rounded-lg shadow-xl py-1 text-xs text-ink font-sans"
        onClick={(e) => e.stopPropagation()}
      >
        {onRename && (
          <button
            type="button"
            role="menuitem"
            onClick={run(onRename)}
            className="w-full text-left px-3 py-1.5 hover:bg-ink/5 flex items-center gap-2 transition-colors cursor-pointer"
          >
            <Pencil size={12} className="text-ink/60" />
            <span>Rename</span>
          </button>
        )}
        {/* Next to Rename because it is the same intent, done for you: omp
            reads the transcript and names the session itself. It replaces an
            existing name, which is why it is an explicit click and never
            something that happens on its own. */}
        {onRenameWithAi && (
          <button
            type="button"
            role="menuitem"
            onClick={run(onRenameWithAi)}
            className="w-full text-left px-3 py-1.5 hover:bg-ink/5 flex items-center gap-2 transition-colors cursor-pointer"
          >
            <WandSparkles size={12} className="text-ink/60" />
            <span>Rename with AI</span>
          </button>
        )}
        {/* A held prompt is the row's whole content, so dropping it belongs in
            the same menu as the row's other verbs rather than on the row face. */}
        {onCancelWait && (
          <button
            type="button"
            role="menuitem"
            onClick={run(onCancelWait)}
            className="w-full text-left px-3 py-1.5 hover:bg-ink/5 flex items-center gap-2 transition-colors cursor-pointer"
          >
            <Hourglass size={12} className="text-ink/60" />
            <span>Cancel waiting prompt</span>
          </button>
        )}
        {onArchive && (
          <button
            type="button"
            role="menuitem"
            onClick={run(onArchive)}
            className="w-full text-left px-3 py-1.5 hover:bg-ink/5 flex items-center gap-2 transition-colors cursor-pointer"
          >
            {isArchived
              ? <ArchiveRestore size={12} className="text-ink/60" />
              : <Archive size={12} className="text-ink/60" />}
            <span>{isArchived ? 'Unarchive' : 'Archive'}</span>
          </button>
        )}
        {(onRename || onRenameWithAi || onArchive || onCancelWait) && onDelete && <div className="my-1 border-t border-ink/10" />}
        {onDelete && (
          <button
            type="button"
            role="menuitem"
            onClick={run(onDelete)}
            className="w-full text-left px-3 py-1.5 hover:bg-error/10 text-error flex items-center gap-2 transition-colors cursor-pointer"
          >
            <Trash2 size={12} className="text-error" />
            <span>Delete</span>
          </button>
        )}
      </div>
    </div>,
    document.body,
  );
}
