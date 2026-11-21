/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The tab strip at the top of a browser-style panel column.
 *
 * The whole chrome of the column: one chip per OPENED view, the add control, and
 * the panel's own two actions. There is no header row beneath it — a second row
 * would be the header the rail style already has, drawn twice.
 *
 * Five behaviours, each of which is the difference between a strip and a row of
 * buttons:
 *
 * - **The chips scroll, the controls never do.** `stripFill` takes the slack and
 *   the trailing controls are `flex-none`, so a narrow column loses chips (which
 *   the user can reach by scrolling) and never loses the close button.
 * - **A fading edge, not a scrollbar.** A strip with hidden chips and no cue is
 *   a strip that looks complete; the mask is driven by measured scroll state
 *   (`data-panel-tabs-scroll`), the same three-valued signal the phone's chip
 *   strip uses.
 * - **The close button is absolutely positioned.** As a flex child it changed
 *   the chip's width on hover, so every name shifted under the pointer.
 * - **The active chip fades its neighbour's separator away.** The pair then
 *   reads as one block, which is what a browser strip does without drawing a
 *   border on the selection.
 * - **Roving tabindex.** `role="tablist"` + `role="tab"` with one tab stop and
 *   Arrow/Home/End, because a strip an assistive user cannot walk is a strip
 *   they cannot use — and the five existing `role="tablist"` surfaces in this
 *   app have no keyboard model at all.
 */

import { useCallback, useEffect, useRef } from 'preact/hooks';
import type { ReactNode } from 'preact/compat';
import { Plus, X } from 'lucide-preact';
import type { ResolvedPanel } from '@/client/components/workspace/plugin-panel/catalog';
import { PanelMark } from '@/client/components/common/panel-mark';
import { PANEL_MARK_SIZE } from '@/shared/lib/workspace/right-panels';
import { scrollLeftForReveal } from '@/shared/lib/ui/scroll-reveal';
import { usePanelReorder } from '@/client/hooks/workspace/panel-reorder';
import type { PanelTabs } from '@/shared/lib/workspace/panel-tabs';

/** Breathing room left between a revealed chip and the strip's edge. */
const REVEAL_PAD_PX = 8;

interface PanelTabStripProps {
  /** The panels to draw, in strip order — already filtered to drawable ones. */
  tabs: PanelTabs;
  /** The panel each id resolves to; an id with no entry is skipped. */
  panels: ReadonlyMap<string, ResolvedPanel>;
  /** The tab the column shows, or `null` for the home page. */
  active: string | null;
  /** The view that cannot be closed (the left column's session list). */
  pinned?: string | null;
  /**
   * The catalog is on screen. NO chip is marked selected then — the home page is
   * not a tab, and a strip that kept one highlighted over the catalog would claim
   * the column is showing a view it is not.
   */
  home?: boolean;
  /** Open the catalog. The host decides whether that is a dialog or a page swap. */
  onAdd: () => void;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  /** The column's own actions (refresh, collapse) — never inside the scroller. */
  actions?: ReactNode;
  /**
   * Adopt a new order after a drag. Omitted means the strip is not reorderable —
   * which is the phone's read-only presentation and the home page's, where no
   * chip is a drag source.
   */
  onReorder?: (ids: readonly string[]) => void;
}

export function PanelTabStrip({
  tabs,
  panels,
  active,
  pinned = null,
  home = false,
  onAdd,
  onSelect,
  onClose,
  actions,
  onReorder,
}: PanelTabStripProps) {
  const stripRef = useRef<HTMLDivElement | null>(null);
  const chipRefs = useRef(new Map<string, HTMLElement>());

  /**
   * Reorder by dragging a chip onto another.
   *
   * The SAME hook the activity bar uses, and for the same two platform reasons
   * (`dataTransfer.getData()` is empty until the drop, and `dragover` fires
   * before the re-render a state write schedules). The commit is a no-op when
   * the caller gave no `onReorder`, so a read-only strip cannot write.
   */
  const commitOrder = useCallback(
    (_visible: readonly string[], nextVisible: readonly string[]) => onReorder?.(nextVisible),
    [onReorder],
  );
  const reorder = usePanelReorder(tabs, commitOrder);
  const reorderable = onReorder !== undefined;
  // The order to DRAW: the drag in progress, or the tabs themselves.
  const order = reorderable ? reorder.order : tabs;

  /**
   * The active tab is revealed because a programmatic selection lands off
   * screen: a request from the navbar, an opened file, a plugin that focuses its
   * own panel. The reveal runs on BOTH the id and the list — the list grows when
   * a plugin finishes loading, and the chip that needs revealing may not have
   * existed on the render the id was stored in.
   */
  useEffect(() => {
    const strip = stripRef.current;
    const chip = active === null ? undefined : chipRefs.current.get(active);
    // A collapsed column measures 0 wide: there is nothing to scroll yet, and
    // the ResizeObserver below runs the reveal once it has a width.
    if (!strip || !chip || strip.clientWidth <= 0) return;
    const stripRect = strip.getBoundingClientRect();
    const chipRect = chip.getBoundingClientRect();
    const next = scrollLeftForReveal(
      {
        scrollLeft: strip.scrollLeft,
        clientWidth: strip.clientWidth,
        scrollWidth: strip.scrollWidth,
        start: chipRect.left - stripRect.left + strip.scrollLeft,
        size: chipRect.width,
      },
      REVEAL_PAD_PX,
    );
    if (next !== strip.scrollLeft) strip.scrollLeft = next;
  }, [active, tabs]);

  /**
   * A width change is not a selection change, and an overflowing strip that only
   * overflows after a resize has no other signal — the last chip is the first
   * one to fall off the right edge. The observer also keeps the fade edge honest.
   */
  useEffect(() => {
    const strip = stripRef.current;
    if (!strip || typeof ResizeObserver === 'undefined') return;

    const paint = () => {
      const overflowing = strip.scrollWidth > strip.clientWidth + 1;
      if (!overflowing) {
        delete strip.dataset.panelTabsScroll;
        return;
      }
      const atStart = strip.scrollLeft <= 1;
      const atEnd = strip.scrollLeft + strip.clientWidth >= strip.scrollWidth - 1;
      strip.dataset.panelTabsScroll = atStart ? 'end' : atEnd ? 'start' : 'start end';
    };

    paint();
    strip.addEventListener('scroll', paint, { passive: true });
    const observer = new ResizeObserver(paint);
    observer.observe(strip);
    return () => {
      strip.removeEventListener('scroll', paint);
      observer.disconnect();
    };
  }, [tabs.length]);

  /**
   * One tab stop, walked with the arrow keys. Enter/Space activate the chip the
   * focus is on; the selection is already a click target, so no extra handler.
   */
  const onKeyDown = (event: KeyboardEvent) => {
    const ids = tabs.filter((id) => panels.has(id));
    const current = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-panel-tab]');
    const from = current?.dataset.panelTab;
    if (!from || ids.length === 0) return;
    const index = ids.indexOf(from);
    let nextId: string | undefined;
    if (event.key === 'ArrowLeft') nextId = ids[(index - 1 + ids.length) % ids.length];
    else if (event.key === 'ArrowRight') nextId = ids[(index + 1) % ids.length];
    else if (event.key === 'Home') nextId = ids[0];
    else if (event.key === 'End') nextId = ids[ids.length - 1];
    else return;
    event.preventDefault();
    if (nextId === undefined) return;
    const nextChip = chipRefs.current.get(nextId);
    nextChip?.focus();
    onSelect(nextId);
  };

  return (
    <div
      // 38px and 28px chips on a pointer; a TOUCH device gets 44/36/28 boxes
      // instead. The desktop strip is measured against a 40px rail, but a 20px
      // close target is under the 44px touch floor — measured in Chromium at
      // 390px: the X was 20x20 inside a 28px chip.
      className="flex h-[38px] flex-none items-center gap-1 border-b border-ink/10 bg-canvas/60 pr-1.5 pl-1.5 select-none pointer-coarse:h-11"
      role="tablist"
      aria-label="Panel views"
      onKeyDown={onKeyDown}
    >
      <button
        type="button"
        onClick={onAdd}
        title="Tambah tab"
        aria-label="Tambah tab"
        className="flex h-7 w-7 flex-none cursor-pointer items-center justify-center rounded-md text-ink/50 transition-colors hover:bg-ink/5 hover:text-ink"
      >
        <Plus size={14} />
      </button>

      <div
        ref={stripRef}
        className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto no-scrollbar"
      >
        {order.map((id) => {
          const panel = panels.get(id);
          if (!panel) return null;
          const isActive = !home && id === active;
          const closable = id !== pinned;
          const label = panel.label || panel.title;
          return (
            <div key={id} className="flex flex-none items-center">
              <div
                role="tab"
                aria-selected={isActive}
                tabIndex={isActive ? 0 : -1}
                data-panel-tab={id}
                ref={(element) => {
                  if (element) chipRefs.current.set(id, element);
                  else chipRefs.current.delete(id);
                }}
                /* The pinned view is neither a drag source nor a drop target:
                   it leads the strip by construction, so letting a drag land
                   in front of it would promise a position the store puts back. */
                /* `undefined`, not `false`: Preact omits a `false` boolean attr
                   entirely, so `draggable={false}` is indistinguishable from an
                   attribute it never wrote — and the test for "this chip cannot
                   be dragged" would pass on a chip that CAN. */
                draggable={reorderable && closable ? true : undefined}
                onDragStart={(event) => {
                  if (!reorderable || !closable) return;
                  reorder.onDragStart(event, id);
                }}
                onDragOver={(event) => {
                  if (!reorderable || !closable) return;
                  reorder.onDragOver(event, id);
                }}
                onDrop={(event) => {
                  if (!reorderable) return;
                  reorder.onDrop(event);
                }}
                onDragEnd={() => {
                  if (!reorderable) return;
                  reorder.onDragEnd();
                }}
                className={`group relative flex h-7 min-w-[80px] max-w-[170px] flex-none items-center rounded-md transition-colors pointer-coarse:h-9 ${
                  isActive ? 'bg-ink/[0.08] text-ink' : 'text-ink/60 hover:bg-ink/5 hover:text-ink'
                } ${reorderable && closable ? 'cursor-grab active:cursor-grabbing' : ''} ${
                  reorder.draggingId === id ? 'opacity-40' : ''
                }`}
              >
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => onSelect(id)}
                  title={panel.title}
                  aria-label={panel.title}
                  className="flex h-full min-w-0 flex-1 cursor-pointer items-center gap-1.5 py-1 pr-6 pl-2 text-left pointer-coarse:pr-8"
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
                    onClick={() => onClose(id)}
                    title={`Tutup ${label}`}
                    aria-label={`Tutup tab ${label}`}
                    /* Always visible, on every chip. A close control revealed only
                       on hover is a control that does not exist on a touch
                       screen and cannot be found by a reader scanning the strip;
                       it also made the ACTIVE chip look like the only closable
                       one, which is the report this fixes. The tint still dims
                       a background tab so the strip reads in one pass. */
                    className={`absolute top-1 right-1 flex h-5 w-5 cursor-pointer items-center justify-center rounded transition-colors hover:bg-ink/10 hover:text-ink pointer-coarse:top-0.5 pointer-coarse:right-0.5 pointer-coarse:h-7 pointer-coarse:w-7 ${
                      isActive ? 'text-ink/45' : 'text-ink/30'
                    }`}
                  >
                    <X size={11} />
                  </button>
                ) : null}
              </div>
              {/* The separator belongs to the gap, not the chip: a chip that
                  painted its own border would shrink its label by 1px on hover
                  and its neighbour's by another. */}
              <span
                aria-hidden="true"
                className={`mx-0.5 h-3.5 w-px bg-ink/15 ${
                  isActive || (!home && tabs[tabs.indexOf(id) + 1] === active) ? 'opacity-0' : 'opacity-100'
                }`}
              />
            </div>
          );
        })}
      </div>

      {actions ? <div className="flex flex-none items-center gap-0.5 pl-1">{actions}</div> : null}
    </div>
  );
}
