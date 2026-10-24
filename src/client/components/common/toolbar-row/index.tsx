/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
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
import { Ellipsis, type LucideIcon } from 'lucide-preact';
import { useOnClickOutside } from '@/client/hooks/ui/on-click-outside';
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

  return (
    <div ref={rowRef} className={`flex flex-nowrap items-center justify-end gap-x-1 overflow-hidden ${className}`}>
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
 */
function OverflowMenu({ actions }: { actions: ToolbarOverflowAction[] }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  useOnClickOutside(rootRef, () => setOpen(false));

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  return (
    <div className="relative flex-shrink-0" ref={rootRef}>
      <button
        type="button"
        title="More actions"
        aria-label="More actions"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className={`flex items-center justify-center p-1.5 rounded transition-colors cursor-pointer ${
          open ? 'bg-ink/10 text-ink' : 'text-ink/50 hover:text-ink hover:bg-ink/5'
        }`}
      >
        <Ellipsis size={14} />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-1 w-52 bg-paper border border-ink/15 rounded-lg shadow-lg z-50 py-1 text-xs"
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
        </div>
      )}
    </div>
  );
}
