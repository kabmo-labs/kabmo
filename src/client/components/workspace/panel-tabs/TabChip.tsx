/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * One chip of a panel column's tab strip.
 *
 * Extracted from `TabStrip` so the strip owns the ROW (the add control, the
 * scroller, the trailing actions) and this owns a single tab. The chip is the
 * only element in the strip that is both a control and a drag SOURCE, and both
 * facts carry a platform trap:
 *
 * - `draggable={false}` is indistinguishable from an attribute never written
 *   (Preact omits a `false` boolean), so the pinned chip's non-draggability is
 *   spelled `undefined` and a test can tell the two apart;
 * - when the strip is the window's drag region, the chip must opt OUT
 *   (`titlebar-no-drag`), or Windows turns it into a drag handle and its click
 *   never fires.
 */

import { X } from 'lucide-preact';
import type { TargetedDragEvent } from 'preact';
import type { ResolvedPanel } from '@/client/components/workspace/plugin-panel/catalog';
import { PanelMark } from '@/client/components/common/panel-mark';
import { PANEL_MARK_SIZE } from '@/shared/lib/workspace/right-panels';
import type { ControlLayout } from '@/client/lib/ui/control-plate';

export interface TabChipProps {
  panel: ResolvedPanel;
  isActive: boolean;
  /** The strip is on its home page, where no chip is selected. */
  parentHome: boolean;
  /** The chip AFTER this one is the active one, so this separator fades. */
  nextIsActive: boolean;
  /** The pinned view leads the column and cannot be closed or dragged. */
  closable: boolean;
  /** The strip adopts a new order; omitted means this strip is read-only. */
  reorderable: boolean;
  /** The chip being dragged right now, drawn dimmed. */
  dragging: boolean;
  /**
   * The strip is the window's drag region, so this chip must opt out of it.
   * Separate from `layout` on purpose: the drag opt-out is a WINDOW fact and
   * the density is a ROW fact, and one standing in for the other is how a chip
   * ends up 28px in a 56px row.
   */
  noDrag: boolean;
  /** Which density this chip draws at — the strip's own layout. */
  layout: ControlLayout;
  chipRef: (element: HTMLElement | null) => void;
  onSelect: () => void;
  onClose: () => void;
  onDragStart: (event: TargetedDragEvent<HTMLElement>) => void;
  onDragOver: (event: TargetedDragEvent<HTMLElement>) => void;
  onDrop: (event: TargetedDragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
}

export function TabChip({
  panel,
  isActive,
  parentHome,
  nextIsActive,
  closable,
  reorderable,
  dragging,
  noDrag,
  layout,
  chipRef,
  onSelect,
  onClose,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: TabChipProps) {
  const label = panel.label || panel.title;
  return (
    // The wrapper is the strip's own flex cell AND the drag opt-out for
    // everything inside it: `app-region` inherits, so marking the chip's
    // controls one at a time is how a future control gets forgotten.
    <div className={`flex flex-none items-center${noDrag ? ' titlebar-no-drag' : ''}`}>
      <div
        role="tab"
        aria-selected={isActive}
        tabIndex={isActive ? 0 : -1}
        data-panel-tab={panel.id}
        ref={chipRef}
        /* The pinned view is neither a drag source nor a drop target: it leads
           the strip by construction, so letting a drag land in front of it
           would promise a position the store puts back. */
        draggable={reorderable && closable ? true : undefined}
        onDragStart={(event) => {
          if (!reorderable || !closable) return;
          onDragStart(event);
        }}
        onDragOver={(event) => {
          if (!reorderable || !closable) return;
          onDragOver(event);
        }}
        onDrop={(event) => {
          if (!reorderable) return;
          onDrop(event);
        }}
        onDragEnd={() => {
          if (!reorderable) return;
          onDragEnd();
        }}
        className={`group relative flex min-w-[80px] max-w-[170px] flex-none items-center rounded-md transition-colors ${
          layout === 'mobile' ? 'h-9' : 'h-7'
        } ${
          isActive ? 'bg-ink/[0.08] text-ink' : 'text-ink/60 hover:bg-ink/5 hover:text-ink'
        } ${reorderable && closable ? 'cursor-grab active:cursor-grabbing' : ''} ${
          dragging ? 'opacity-40' : ''
        }`}
      >
        <button
          type="button"
          tabIndex={-1}
          onClick={onSelect}
          title={panel.title}
          aria-label={panel.title}
          className={`flex h-full min-w-0 flex-1 cursor-pointer items-center gap-1.5 py-1 pl-2 text-left ${
            layout === 'mobile' ? 'pr-8' : 'pr-6'
          }`}
        >
          <PanelMark
            className="inline-flex flex-none"
            panelId={panel.id}
            builtin={panel.builtin}
            icon={panel.builtin ? panel.icon : undefined}
            name={panel.builtin ? panel.label : panel.name}
            {...(panel.iconUrl ? { iconUrl: panel.iconUrl } : {})}
            {...(panel.color ? { color: panel.color } : {})}
            size={PANEL_MARK_SIZE}
          />
          <span className="truncate text-[11px] font-medium">{label}</span>
        </button>
        {closable ? (
          <button
            type="button"
            tabIndex={-1}
            onClick={onClose}
            title={`Tutup ${label}`}
            aria-label={`Tutup tab ${label}`}
            /* Always visible, on every chip. A close control revealed only on
               hover is a control that does not exist on a touch screen and
               cannot be found by a reader scanning the strip; it also made the
               ACTIVE chip look like the only closable one. The tint still dims
               a background tab so the strip reads in one pass. */
            className={`absolute flex cursor-pointer items-center justify-center rounded transition-colors hover:bg-ink/10 hover:text-ink ${
              layout === 'mobile' ? 'top-0.5 right-0.5 h-7 w-7' : 'top-1 right-1 h-5 w-5'
            } ${isActive ? 'text-ink/45' : 'text-ink/30'}`}
          >
            <X size={11} />
          </button>
        ) : null}
      </div>
      {/* The separator belongs to the gap, not the chip: a chip that painted its
          own border would shrink its label by 1px on hover and its neighbour's
          by another. It fades beside the active chip so the pair reads as one
          block, and fades entirely on the home page, where no chip is
          selected. */}
      <span
        aria-hidden="true"
        className={`mx-0.5 h-3.5 w-px bg-ink/15 ${
          isActive || (parentHome && nextIsActive) ? 'opacity-0' : 'opacity-100'
        }`}
      />
    </div>
  );
}
