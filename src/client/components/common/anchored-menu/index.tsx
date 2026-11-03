/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * A menu that hangs off a trigger, portalled to `document.body`.
 *
 * Two defects make this its own module rather than a class on each call site:
 *
 * - **A dropdown inside a `z-index`ed ancestor cannot paint over its siblings.**
 *   A positioned or flex item with a `z-index` establishes a stacking context,
 *   so a `z-50` menu inside the sidebar's `sticky z-10` workspace header was
 *   still BELOW the next workspace's `sticky z-10` header — the reported "menu
 *   appears, then disappears under the folder below it". Measured before this
 *   module: `elementFromPoint` at the menu's own centre answered the next
 *   header's button. The desktop navbar had the same shape one level up: the
 *   `header` is a flex item at `z-20`, so the server panel's `z-50` lost to
 *   anything at `z-20`+ in the chat column.
 * - **`overflow` clips a menu, `fixed` or not.** A menu drawn inside the
 *   sidebar's scroller is cut at the scroller's edge and drifts with the rows
 *   when it scrolls (`toolbar-row/OverflowMenu` documents the same bug from the
 *   other direction).
 *
 * So the panel is a `fixed` node in `document.body` at `z-[70]` — above the
 * navbar (`z-20`), the panels (`z-50`) and the modals (`z-[60]`), below toasts
 * (`z-[200]`) — placed from the trigger's measured rectangle (`placeMenu`) and
 * measured again whenever its own content changes height.
 *
 * The dismissal surface is a full-viewport layer at the same layer, which is
 * also what makes the grid behind it inert: a click outside closes the menu,
 * and the wheel cannot scroll the list out from under it.
 *
 * The phone's server sheet passes `viewportStyle` instead of `anchor`: it is
 * pinned below the title bar rather than to a trigger sitting near the edge
 * (`shared/lib/ui/mobile-overlay` owns those insets).
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import type { CSSProperties } from 'preact/compat';
import { createPortal } from 'preact/compat';
import { placeMenu, type AnchorRect, type MenuAlign, type MenuPlacement } from '@/shared/lib/ui/menu-anchor';
import type { MobileOverlayStyle } from '@/shared/lib/ui/mobile-overlay';

export interface AnchoredMenuProps {
  /** The trigger's viewport rectangle, or null while the menu is closed. */
  anchor: AnchorRect | null;
  align?: MenuAlign;
  /** Pin to the viewport (a phone sheet) instead of hanging off the anchor. */
  viewportStyle?: MobileOverlayStyle;
  /**
   * `dialog` for the server sheet — a panel with headings and an Add form.
   * Omitted for the folder menus: their rows are plain buttons (as they were
   * before the portal), and claiming `menu` would promise arrow-key roving that
   * no one implements.
   */
  role?: 'dialog';
  /** Names the panel; every caller labels it by the trigger it opened from. */
  ariaLabel?: string;
  /** The panel's own chrome: width, padding, border, typography. */
  className: string;
  /** Close on Escape, on a click outside, and on a context menu. */
  onClose: () => void;
  children: ComponentChildren;
}

export function AnchoredMenu({
  anchor,
  align = 'end',
  viewportStyle,
  role,
  ariaLabel,
  className,
  onClose,
  children,
}: AnchoredMenuProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<MenuPlacement | null>(null);

  // Measured before paint, and re-measured on every render: the folder menu
  // swaps its rows for the delete confirmation, which changes its height, and a
  // placement computed for the shorter menu put the longer one past the window
  // edge. The state is only written when a number actually moved, so this
  // settles in one extra render instead of looping.
  useLayoutEffect(() => {
    if (viewportStyle) return;
    if (!anchor || !panelRef.current) return;
    const box = panelRef.current.getBoundingClientRect();
    const next = placeMenu(
      anchor,
      { width: box.width, height: box.height },
      { width: window.innerWidth, height: window.innerHeight },
      align,
    );
    setPlacement((prev) =>
      prev && prev.top === next.top && prev.left === next.left && prev.maxHeight === next.maxHeight ? prev : next,
    );
  });

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  if (!anchor && !viewportStyle) return null;

  const style: CSSProperties = viewportStyle
    ? { ...viewportStyle }
    : placement
      ? { top: `${placement.top}px`, left: `${placement.left}px`, maxHeight: `${placement.maxHeight}px` }
      : // The single pre-measure render. Hidden rather than drawn at 0,0, so a
        // menu never flashes in the corner before the layout effect settles it.
        { top: '0px', left: '0px', visibility: 'hidden' };

  return createPortal(
    <div
      className="fixed inset-0 z-[70]"
      onClick={onClose}
      onContextMenu={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div
        ref={panelRef}
        role={role}
        aria-label={ariaLabel}
        className={`fixed z-[70] overflow-y-auto overscroll-contain ${className}`}
        style={style}
        onClick={(event) => event.stopPropagation()}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
