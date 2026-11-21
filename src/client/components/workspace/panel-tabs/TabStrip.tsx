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
import type { CSSProperties, ReactNode } from 'preact/compat';
import { Plus } from 'lucide-preact';
import type { ResolvedPanel } from '@/client/components/workspace/plugin-panel/catalog';
import { TabChip } from '@/client/components/workspace/panel-tabs/TabChip';
import {
  CONTROL_BOX,
  CONTROL_GLYPH_PX,
  CONTROL_ROW_GAP,
  CONTROL_ROW_HEIGHT,
  CONTROL_ROW_INSET,
  type ControlLayout,
} from '@/client/lib/ui/control-plate';
import { scrollLeftForReveal } from '@/shared/lib/ui/scroll-reveal';
import { usePanelReorder } from '@/client/hooks/workspace/panel-reorder';
import type { PanelTabs } from '@/shared/lib/workspace/panel-tabs';

/** Breathing room left between a revealed chip and the strip's edge. */
const REVEAL_PAD_PX = 8;

export interface PanelTabStripProps {
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
  /**
   * Which chrome density the row draws at.
   *
   * NOT derivable from `dragRegion`: a desktop shell window narrowed past the
   * layout breakpoint can be a drag region while still being the desktop
   * layout. The phone's right drawer passes `mobile`; every desktop column
   * leaves the default.
   */
  layout?: ControlLayout;
  /**
   * Make the strip the window's drag handle.
   *
   * A phone-width shell window (all three shells allow 720px) renders this
   * layout, and when the right drawer is the mounted screen its strip is the
   * only horizontal chrome left — without a drag region the window cannot be
   * moved at all. The CHIPS are drag SOURCES (`draggable`), which a drag region
   * would eat, so they carry `titlebar-no-drag` themselves; the strip's
   * background between them is the handle.
   */
  dragRegion?: boolean;
  /** Style for the strip's own row (the phone passes its titlebar insets). */
  style?: CSSProperties;
  /**
   * Extra attributes for the row — the phone's drawer spreads its long-press
   * menu handlers here, because under the tab style this row replaced the
   * header that used to own them.
   */
  rootProps?: Record<string, unknown>;
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
  dragRegion = false,
  layout = 'desktop',
  style,
  rootProps,
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
      // The ROW is the top navbar's, stated once in `control-plate.ts`:
      // `h-10` beside a desktop column, the phone header's 56px plus the notch
      // when this strip IS the title bar. Height, inset and control box come
      // from that one module so the strip cannot drift to a third density —
      // measured misalignment before this: strip 40px against a 56px phone
      // header, controls 28px against 36px, `+` centre 26 against 30.
      className={`flex flex-none items-center ${CONTROL_ROW_GAP} border-b border-ink/10 bg-canvas/60 select-none ${
        CONTROL_ROW_HEIGHT[layout]
      } ${CONTROL_ROW_INSET[layout]} ${dragRegion ? 'titlebar-drag-region' : ''}`}
      style={style}
      role="tablist"
      aria-label="Panel views"
      onKeyDown={onKeyDown}
      {...rootProps}
    >
      {/* The add control and the trailing actions are OUTSIDE the scroller, so
          a strip full of chips can never scroll them away: the row is
          `[+] [ chips … → ] [actions]` and only the middle flexes. */}
      <button
        type="button"
        onClick={onAdd}
        title="Tambah tab"
        aria-label="Tambah tab"
        className={`${CONTROL_BOX[layout]} flex-none cursor-pointer rounded-md text-ink/50 transition-colors hover:bg-ink/5 hover:text-ink ${
          dragRegion ? 'titlebar-no-drag' : ''
        }`}
      >
        <Plus size={CONTROL_GLYPH_PX[layout]} />
      </button>

      <div
        ref={stripRef}
        className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto no-scrollbar"
      >
        {order.map((id) => {
          const panel = panels.get(id);
          if (!panel) return null;
          const isActive = !home && id === active;
          return (
            <TabChip
              key={id}
              panel={panel}
              isActive={isActive}
              parentHome={home}
              nextIsActive={!home && tabs[tabs.indexOf(id) + 1] === active}
              closable={id !== pinned}
              reorderable={reorderable}
              dragging={reorder.draggingId === id}
              noDrag={dragRegion}
              layout={layout}
              chipRef={(element) => {
                if (element) chipRefs.current.set(id, element);
                else chipRefs.current.delete(id);
              }}
              onSelect={() => onSelect(id)}
              onClose={() => onClose(id)}
              onDragStart={(event) => reorder.onDragStart(event, id)}
              onDragOver={(event) => reorder.onDragOver(event, id)}
              onDrop={(event) => reorder.onDrop(event)}
              onDragEnd={() => reorder.onDragEnd()}
            />
          );
        })}
      </div>

      {actions ? (
        <div className={`flex flex-none items-center gap-0.5 pl-1 ${dragRegion ? 'titlebar-no-drag' : ''}`}>
          {actions}
        </div>
      ) : null}
    </div>
  );
}
