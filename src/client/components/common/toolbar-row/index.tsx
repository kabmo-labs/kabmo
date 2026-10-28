/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * One toolbar row that never becomes two.
 *
 * The editor and diff toolbars carry ten-plus controls and the editor panel is
 * 320px wide on a 1440px screen. WRAPPING was the previous answer and it is the
 * wrong one: a second row moves the document down by the toolbar's own height
 * and reads as a second toolbar. A horizontal scroll is worse — a clipped
 * control is invisible. So the clusters that do not fit move into a `⋯` menu and
 * every control stays one click away.
 *
 * Widths are MEASURED, never tabulated: the row lays every cluster out once and
 * reads each one's rendered width, then hides what does not fit. A table of
 * guessed pixel widths drifts the moment a label, an icon or a font changes, and
 * a wrong guess here is a control that is either clipped or needlessly buried.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { createPortal } from 'preact/compat';
import { Ellipsis, type LucideIcon } from 'lucide-preact';
import { toolbarHasOverflow, toolbarVisibleClusters } from '@/shared/lib/ui/toolbar-overflow';

/** One row the `⋯` menu offers when its cluster is not on the row. */
export interface ToolbarOverflowAction {
  label: string;
  icon: LucideIcon;
  onSelect: () => void;
  /** Rendered as a pressed row (word wrap on, a mode already active). */
  active?: boolean;
  disabled?: boolean;
}

/**
 * A logical group of controls that hides as a unit.
 *
 * A group rather than a single button because the clusters are already grouped
 * in the toolbars (zoom is two buttons, copy/download is a pair, the width modes
 * are a pair) and splitting them would let half of a pair stay on the row.
 */
export interface ToolbarCluster {
  id: string;
  /**
   * Never leave the row, whatever its width.
   *
   * The visual order is not the priority order: Save is drawn first because that
   * is where a reader looks for it, while the width modes sit last and are the
   * reason the panel exists. Pinning says which ones a menu row must not be the
   * only way to reach.
   */
  pinned?: boolean;
  /** What the `⋯` menu offers when this cluster is hidden. */
  actions: ToolbarOverflowAction[];
  children: ComponentChildren;
}

interface ToolbarRowProps {
  clusters: ToolbarCluster[];
  className?: string;
}

export function ToolbarRow({ clusters, className = '' }: ToolbarRowProps) {
  const rowRef = useRef<HTMLDivElement>(null);
  /** Measured widths, tagged with the cluster set they describe. */
  const [metrics, setMetrics] = useState<{ signature: string; widths: number[] } | null>(null);
  const [available, setAvailable] = useState(0);

  // The set changes when a conditional cluster appears or disappears (a
  // previewable file opened, a byte viewer took over), and stale widths would
  // then hide the wrong cluster. Rendering every cluster until they are measured
  // is what gives the ruler something to measure — and the layout effect runs
  // BEFORE paint, so the unresolved frame is never seen.
  const signature = clusters.map((cluster) => `${cluster.id}:${cluster.pinned ? 1 : 0}`).join('|');
  const ready = metrics?.signature === signature;
  const widths = ready ? metrics.widths : [];
  const pinned = clusters.map((cluster) => cluster.pinned === true);
  const visible = widths.length > 0
    ? toolbarVisibleClusters({ widths, pinned, available })
    : clusters.map(() => true);

  useLayoutEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    if (!ready) {
      const children = [...row.querySelectorAll<HTMLElement>('[data-toolbar-cluster]')];
      if (children.length === clusters.length) {
        setMetrics({ signature, widths: children.map((child) => child.getBoundingClientRect().width) });
      }
    }
    setAvailable(row.clientWidth);
  });

  // The row's width changes on a window resize, a panel drag and a layout mode
  // switch — none of which are `window` events.
  useEffect(() => {
    const row = rowRef.current;
    if (!row || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => setAvailable(row.clientWidth));
    observer.observe(row);
    return () => observer.disconnect();
  }, []);

  const hiddenActions = clusters.filter((_, index) => !visible[index]).flatMap((cluster) => cluster.actions);

  // `flex-1 min-w-0` is what makes `available` mean anything. Without it the row
  // is content-sized (`ml-auto` in a `justify-between` parent), so its width IS
  // the sum of the clusters it currently shows — hiding one shrinks the row,
  // which shrinks `available`, which hides another, and the row settles at a
  // fraction of the space it was given and never grows back when the panel is
  // widened. Measured: a 373px diff panel reported a 204px row at every
  // viewport, so Unified/Split/Full Code lived in `⋯` on a wide screen. `min-w-0`
  // is required with it, or the `flex-shrink-0` clusters set a content-based
  // minimum and the row refuses to be narrower than all of them.
  return (
    <div ref={rowRef} className={`flex flex-1 min-w-0 flex-nowrap items-center justify-end gap-x-1 overflow-hidden ${className}`}>
      {clusters.map((cluster, index) =>
        visible[index] ? (
          <div key={cluster.id} data-toolbar-cluster="" className="flex items-center flex-shrink-0">
            {cluster.children}
          </div>
        ) : null,
      )}
      {toolbarHasOverflow(visible) && <OverflowMenu actions={hiddenActions} />}
    </div>
  );
}

/**
 * The `⋯` trigger and its menu.
 *
 * A menu rather than a horizontal scroll: a clipped action is invisible, and the
 * diff toolbar already learned that a scroll strip with no visible scrollbar
 * reads as "there is nothing more here" (measured: 361px of content in a 296px
 * box, with `Stage` entirely outside it).
 *
 * The menu is PORTALLED to `document.body`, and that is not a preference — the
 * row it hangs from is `overflow-hidden` and only one line tall, so an
 * absolutely-positioned menu below the trigger is clipped to nothing. Measured
 * before the portal: the menu laid out at 208×206px and `elementFromPoint` at
 * its own centre answered a `.cm-line` in the diff BEHIND it, so every row was
 * invisible and unclickable while the trigger reported `aria-expanded="true"`.
 * A `fixed` menu inside the row would not help either: `overflow-hidden` clips
 * a fixed descendant too, because the row establishes the containing block.
 *
 * Position comes from the trigger's own viewport rect, clamped against both
 * edges, so a menu on the right-hand toolbar of a narrow panel cannot draw its
 * rows past the window.
 */
function OverflowMenu({ actions }: { actions: ToolbarOverflowAction[] }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // A dismiss handler that knows about BOTH nodes. `useOnClickOutside` takes one
  // ref, and the menu is no longer inside the trigger's subtree — a mousedown on
  // a menu row would read as "outside", close the menu, and the `click` would
  // never reach the button. That is the same dead menu in a new shape.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: globalThis.MouseEvent | globalThis.TouchEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  // Measured before paint, and re-measured when the row's own size changes: the
  // trigger sits at the row's trailing edge, so a panel drag moves it.
  useLayoutEffect(() => {
    if (!open) return;
    const trigger = rootRef.current?.firstElementChild as HTMLElement | null;
    const menu = menuRef.current;
    if (!trigger || !menu) return;
    const anchor = trigger.getBoundingClientRect();
    const { width, height } = menu.getBoundingClientRect();
    const margin = 8;
    const below = anchor.bottom + 4;
    const top = below + height + margin <= window.innerHeight ? below : Math.max(margin, anchor.top - height - 4);
    const left = Math.max(margin, Math.min(anchor.right - width, window.innerWidth - width - margin));
    setPosition({ top, left });
  }, [open, actions.length]);

  return (
    <div className="relative flex-shrink-0" ref={rootRef}>
      <button
        type="button"
        title="More actions"
        aria-label="More actions"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          setPosition(null);
          setOpen(!open);
        }}
        className={`flex items-center justify-center p-1.5 rounded transition-colors cursor-pointer ${
          open ? 'bg-ink/10 text-ink' : 'text-ink/50 hover:text-ink hover:bg-ink/5'
        }`}
      >
        <Ellipsis size={14} />
      </button>

      {open &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            style={{
              top: position?.top ?? 0,
              left: position?.left ?? 0,
              // Hidden for the single pre-measure render; the layout effect
              // settles the position before the browser paints.
              visibility: position ? 'visible' : 'hidden',
            }}
            className="fixed z-[80] w-52 bg-paper border border-ink/15 rounded-lg shadow-lg py-1 text-xs"
          >
            {actions.map((action) => (
              <button
                key={action.label}
                type="button"
                role="menuitem"
                disabled={action.disabled}
                aria-pressed={action.active}
                onClick={() => {
                  setOpen(false);
                  action.onSelect();
                }}
                className={`w-full text-left flex items-center gap-2 px-3 py-1.5 transition-colors disabled:cursor-default disabled:opacity-40 ${
                  action.active ? 'bg-ink/5 text-ink font-medium' : 'text-ink/75 hover:bg-ink/5 hover:text-ink'
                }`}
              >
                <action.icon size={13} className="flex-shrink-0" />
                <span className="truncate">{action.label}</span>
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}
