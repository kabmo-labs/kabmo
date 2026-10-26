/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The tab strip's context menu, drawn from `tab-menu.ts`'s rows.
 *
 * A portal to `document.body`, like every other menu here: the tab strip is a
 * horizontal scroller inside a resizable panel, and a `position: fixed` menu nested in
 * one is clipped the moment the panel is narrower than the menu.
 *
 * The geometry is measured, not guessed — a hand-written height puts the last rows off
 * screen the moment a row is added, which is the failure the Files panel's own menu
 * documents.
 */

import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { createPortal } from 'preact/compat';

import type { TabMenuAction, TabMenuRow } from '@/client/lib/editor/tab-menu';

interface TabContextMenuProps {
  x: number;
  y: number;
  rows: TabMenuRow[];
  onAction: (action: TabMenuAction) => void;
  onClose: () => void;
}

export function TabContextMenu({ x, y, rows, onAction, onClose }: TabContextMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState({ left: x, top: y });

  // Clamp against the viewport's edges once the menu has a real height. A menu opened
  // near the bottom would otherwise draw its last rows past the window.
  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const { width, height } = menu.getBoundingClientRect();
    setPosition({
      left: Math.min(x, Math.max(0, window.innerWidth - width - 8)),
      top: Math.min(y, Math.max(0, window.innerHeight - height - 8)),
    });
  }, [x, y, rows.length]);

  return createPortal(
    <div className="fixed inset-0 z-[70]" onClick={onClose} onContextMenu={(event) => { event.preventDefault(); onClose(); }}>
      <div
        ref={menuRef}
        role="menu"
        aria-label="Tab actions"
        className="absolute w-52 bg-paper border border-ink/15 rounded-md shadow-xl py-1 text-xs text-ink"
        style={{ left: `${position.left}px`, top: `${position.top}px` }}
        onClick={(event) => event.stopPropagation()}
      >
        {rows.map((row) => (
          <button
            key={row.action}
            type="button"
            role="menuitem"
            onClick={() => {
              onAction(row.action);
              onClose();
            }}
            className="w-full text-left px-3 py-1.5 hover:bg-ink/5 transition-colors cursor-pointer"
          >
            {row.label}
          </button>
        ))}
      </div>
    </div>,
    document.body,
  );
}
