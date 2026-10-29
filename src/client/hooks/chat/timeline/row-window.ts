/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The timeline's mounted window: which rows exist in the DOM right now.
 *
 * Every row used to stay mounted for the life of the session. Paging history
 * prepends to the same array and nothing is ever released, so a long session
 * accumulated DOM for every page the reader had scrolled through — measured on
 * this machine (production bundle, WebKit, one 9.4 MB session): 10 pages =
 * 107 807 nodes and 891 MB of WebContent footprint, with NOT ONE node released
 * when the reader scrolled away, and reloading the same session brought it back
 * to 11 438 nodes. The cost is the mounted rows, not the data.
 *
 * Three things make this safe rather than merely smaller:
 *
 * - **Heights are MEASURED, never assumed.** A user bubble, a thinking
 *   accordion and a tool card with 1 000 lines of output are all one row, so a
 *   constant row height would put the scrollbar in the wrong place within a
 *   screen. Each mounted row reports its height; the rows nobody has seen take
 *   the measured average (see `shared/lib/chat/timeline/row-window.ts`).
 * - **A measurement does not move the reader.** Rows above the viewport change
 *   the content height, so the anchor (the row at the top of the viewport and
 *   the offset inside it) is captured before a re-layout and restored after it.
 * - **A jump mounts its target first.** `revealRow` writes the scroll offset of
 *   the row's ESTIMATED position, which mounts it, and re-applies the offset for
 *   a few frames so the landing is the measured one.
 */

import type { RefObject } from 'preact/compat';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { layoutTimelineRows, rowIndex, rowScrollOffset, timelineWindow } from '@/shared/lib/chat/timeline/row-window';

/**
 * How long a reveal keeps correcting after it first moves the viewport.
 *
 * Wall-clock rather than a frame count: the rows it just mounted are measured on
 * later commits (a tool card's output arrives through a deferred highlight, an
 * image decodes), and every measurement above the target moves it. Measured
 * here, a fixed short window left a jump to the newest turn 300 px short of the
 * tail — outside the follow-mode threshold, so the stream stopped following
 * after the jump.
 */
const REVEAL_SETTLE_MS = 3000;

/** Consecutive still frames that end a reveal early — the layout has settled. */
const REVEAL_STILL_FRAMES = 10;

/** How long a reveal waits for a row the pager is still bringing in. */
const REVEAL_DEADLINE_MS = 3000;

/** A measurement is only adopted when it differs by more than this. */
const MEASURE_EPSILON_PX = 0.5;

/** Distance from the bottom, in px, that makes a reader "at the tail". Mirrors
 *  `FOLLOW_BOTTOM_THRESHOLD_PX` in `scroll.ts`: below it, follow mode is on. */
const TAIL_ANCHOR_PX = 100;

/**
 * Write a scroll position that is meant to LAND, not to animate.
 *
 * The timeline container carries Tailwind's `scroll-smooth`, and CSS
 * `scroll-behavior` applies to a `scrollTop` ASSIGNMENT too (CSSOM-View:
 * the setter scrolls with `behavior: auto`, which resolves to the element's
 * computed `scroll-behavior`). So `el.scrollTop = target` started a smooth
 * animation, the reveal's correction loop re-targeted it every frame, and the
 * jump was left mid-flight wherever the loop stopped — measured on a
 * 240-message session: the trace walked 9 804 → 6 504 px and stayed there.
 * `behavior: 'instant'` is the one value CSS cannot override.
 */
function writeScrollTop(el: HTMLElement, top: number): void {
  if (Math.abs(el.scrollTop - top) <= 1) return;
  el.scrollTo({ top, behavior: 'instant' });
}

export interface TimelineRowWindow {
  /** First mounted row index (inclusive). */
  start: number;
  /** Last mounted row index (exclusive). */
  end: number;
  /** Spacer height above the mounted rows. */
  padTop: number;
  /** Spacer height below the mounted rows. */
  padBottom: number;
  /**
   * Scroll `id` into the middle of the viewport, mounting it if needed.
   *
   * Resolves when the landing has SETTLED (the layout stopped moving it), or
   * at the reveal's deadline. Callers that must hold something off until the
   * viewport is theirs — follow mode, in `useRailJump` — await this instead of
   * guessing a duration.
   */
  revealRow: (id: string) => Promise<void>;
}

export interface UseTimelineRowWindowDeps {
  /** Every row id, in order — the whole session, not the mounted slice. */
  ids: readonly string[];
  /** The timeline's scroll container. */
  scrollRef: RefObject<HTMLDivElement>;
  /**
   * The scroll container as STATE, not only as a ref (see
   * `useChatTimelineScroll`). Every effect below SUBSCRIBES to the node, so it
   * must key on this and never on `scrollRef`: the surface is swapped in after
   * the full-panel skeleton, and a ref identity never changes, so an effect
   * keyed on the ref ran once — before the scroller existed — and never again.
   * Measured with the effect keyed on the ref: `scrollTop` 9 804 with rows 0–10
   * mounted and a 9 374 px bottom spacer, i.e. a blank tail whose rail clicks
   * wrote `scrollTop` into a spacer and mounted nothing.
   */
  scrollNode: HTMLDivElement | null;
  /** False renders every row (a short list, or a surface without a scroller). */
  enabled?: boolean;
}

export function useTimelineRowWindow({ ids, scrollRef, scrollNode, enabled = true }: UseTimelineRowWindowDeps): TimelineRowWindow {
  // Heights of rows that have been on screen at least once, by id — so a row
  // keeps its height across being unmounted, which is what keeps the scrollbar
  // steady while the reader moves through a long session.
  const measuredRef = useRef(new Map<string, number>());
  // Bumped when a measurement changed the layout; the layout is memoized on it.
  const [version, setVersion] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(0);
  // The scroll container. STATE, not the ref: see `scrollNode` in the deps.
  const element = scrollNode;
  // The row at the top of the viewport, captured before a re-layout so the
  // reader's position can be restored after it. `scrollTop` is recorded with it
  // so a restore can tell that SOMETHING ELSE moved the viewport in between —
  // the opening jump to the tail, a rail jump, the follow pin — and stand down
  // instead of writing the reader's old position back over it.
  const anchorRef = useRef<{ id: string; offset: number; scrollTop: number; tail: boolean } | null>(null);
  /**
   * The viewport belongs to the BOTTOM until the reader scrolls away.
   *
   * Set by a reveal that targets the last row. The reveal resolves as soon as
   * the position is still, and the rows ABOVE it are still estimates until they
   * mount — so the next measurement moves the bottom by its own error, and
   * nothing puts it back: measured, a jump to the newest turn settled 300 px
   * short of the tail, which is past `scroll.ts`'s 100 px follow threshold, so
   * the stream stopped following after the jump.
   */
  const tailPinRef = useRef(false);

  const layout = useMemo(
    () => layoutTimelineRows(ids, measuredRef.current),
    // `version` is the measurement signal; `ids` is the row list itself.
    [ids, version],
  );
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const idsRef = useRef(ids);
  idsRef.current = ids;
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;
  // Bumped per reveal so a superseded one stops writing.
  const revealGenerationRef = useRef(0);

  const range = useMemo(
    () => (enabled ? timelineWindow(layout, scrollTop, viewport) : { start: 0, end: ids.length, padTop: 0, padBottom: 0 }),
    [enabled, layout, scrollTop, viewport, ids.length],
  );

  // Track the viewport's geometry. A rAF-coalesced read: scroll fires far more
  // often than a window can change.
  useEffect(() => {
    if (!enabled) return;
    const el = element;
    if (!el) return;
    let frame: number | null = null;
    const read = (): void => {
      frame = null;
      setScrollTop(el.scrollTop);
      setViewport(el.clientHeight);
    };
    let lastTop = el.scrollTop;
    const onScroll = (): void => {
      // The reader took the viewport back: the tail no longer owns the position.
      if (el.scrollTop < lastTop - 1) tailPinRef.current = false;
      lastTop = el.scrollTop;
      if (frame === null) frame = requestAnimationFrame(read);
    };
    read();
    el.addEventListener('scroll', onScroll, { passive: true });
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(read);
    observer?.observe(el);
    return () => {
      el.removeEventListener('scroll', onScroll);
      observer?.disconnect();
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [enabled, element]);

  // Measure what is on screen. A layout effect, so the sizes are read before
  // the browser paints the frame that would show the wrong spacer heights.
  //
  // The rows are also OBSERVED, not measured once: a streaming answer grows its
  // row every frame, an accordion expands, an image decodes — and a stale height
  // there is a scrollbar that describes a session shorter than it is, which is
  // what makes a jump land short. `range` is a dependency because a new window
  // means a new set of nodes to observe.
  useLayoutEffect(() => {
    if (!enabled) return;
    const el = element;
    if (!el) return;
    const measure = (): boolean => {
      let changed = false;
      for (const node of el.querySelectorAll<HTMLElement>('[data-row-id]')) {
        const id = node.dataset.rowId;
        if (!id) continue;
        const height = node.getBoundingClientRect().height;
        if (height <= 0) continue;
        const previous = measuredRef.current.get(id);
        if (previous !== undefined && Math.abs(previous - height) <= MEASURE_EPSILON_PX) continue;
        measuredRef.current.set(id, height);
        changed = true;
      }
      return changed;
    };
    const adopt = (): void => {
      const current = timelineWindow(layout, el.scrollTop, el.clientHeight, 0);
      const anchorId = ids[current.start];
      if (anchorId) {
        anchorRef.current = {
          id: anchorId,
          offset: el.scrollTop - layout.offsets[current.start],
          scrollTop: el.scrollTop,
          // A reader parked at the tail follows the TAIL, not the row that
          // happened to be at the top of the viewport: the rows below it are
          // estimates until they mount, so a row anchor would leave the
          // viewport short of the bottom — measured at 775 px on an opened
          // session, which is past the 100 px threshold that decides whether
          // the stream keeps following.
          // Measured against the PREVIOUS layout, not the DOM: this effect runs
          // after the content already grew, so the DOM's own distance is the
          // growth itself. A reader who was at the bottom before a row was
          // measured taller must stay at the bottom — measured against the DOM
          // they were left 2 080 px short, i.e. outside follow mode.
          tail: layout.total - scrollTop - (viewport || el.clientHeight) <= TAIL_ANCHOR_PX,
        };
      }
      setVersion((value) => value + 1);
    };
    if (measure()) adopt();

    if (typeof ResizeObserver === 'undefined') return;
    let frame: number | null = null;
    const observer = new ResizeObserver(() => {
      if (frame !== null) return;
      // Deferred like the scroll pin in `scroll.ts`: a layout write from inside
      // an observer delivery makes the browser re-run observers in the same
      // frame, and the report it eventually raises is an uncaught page error.
      frame = requestAnimationFrame(() => {
        frame = null;
        if (measure()) adopt();
      });
    });
    for (const node of el.querySelectorAll('[data-row-id]')) observer.observe(node);
    return () => {
      observer.disconnect();
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [enabled, ids, layout, element, range.start, range.end]);

  // Restore the reading position after the layout moved under it.
  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    anchorRef.current = null;
    const el = element;
    if (!el) return;
    // The viewport moved between the capture and this commit: a rail jump, the
    // opening jump to the tail, the follow pin, the reader's own scroll. That
    // mover owns the position — writing the captured one back is how a jump
    // landed and was then dragged to the tail, and how the reveal and this
    // effect ping-ponged a viewport between `0` and its target every frame
    // (measured: `scrollTo` writes alternating 4 913 / 0 for the whole reveal).
    if (anchor.tail || tailPinRef.current) {
      // The bottom edge is the anchor. `writeScrollTop`, because the container
      // carries `scroll-smooth`: a bare `scrollTop` assignment animates, and a
      // correction that animates is a correction that arrives late.
      writeScrollTop(el, Math.max(0, el.scrollHeight - el.clientHeight));
      return;
    }
    const index = rowIndex(ids, anchor.id);
    if (index < 0) return;
    const target = layout.offsets[index] + anchor.offset;
    writeScrollTop(el, target);
  }, [layout, ids, element]);

  const revealRow = useCallback(
    (id: string): Promise<void> => {
      const el = scrollRef.current;
      if (!el) return Promise.resolve();
      const deadline = Date.now() + REVEAL_DEADLINE_MS;
      const settleBy = Date.now() + REVEAL_SETTLE_MS;
      // Supersedes an earlier reveal: two rail clicks in a row must land on the
      // SECOND turn, not race each other to the first one's position.
      const generation = (revealGenerationRef.current += 1);
      return new Promise<void>((resolve) => {
        let stillFrames = 0;
        let lastTop = -1;
        const step = (): void => {
          if (generation !== revealGenerationRef.current) {
            resolve();
            return;
          }
          const rows = idsRef.current;
          const index = rowIndex(rows, id);
          if (index < 0) {
            // The pager may still be bringing the row in; keep asking until the
            // deadline rather than scrolling to a row that does not exist yet.
            if (Date.now() < deadline) requestAnimationFrame(step);
            else resolve();
            return;
          }
          const current = layoutRef.current;
          const view = el.clientHeight || viewportRef.current;
          // The newest turn is the TAIL, not the centre of the last row: that
          // is what the reader means by jumping there, and it is what lets
          // follow mode re-engage (the scroll handler's threshold is 100 px).
          tailPinRef.current = index === rows.length - 1;
          const target = tailPinRef.current
            ? Math.max(0, el.scrollHeight - view)
            : rowScrollOffset(current, index, view);
          writeScrollTop(el, target);
          // A row that was just mounted is measured on a later commit; the
          // corrections land on the MEASURED position rather than the estimate
          // the first write used.
          stillFrames = Math.abs(el.scrollTop - lastTop) <= 1 ? stillFrames + 1 : 0;
          lastTop = el.scrollTop;
          if (stillFrames >= REVEAL_STILL_FRAMES || Date.now() >= settleBy) {
            resolve();
            return;
          }
          requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      });
    },
    [scrollRef],
  );

  return useMemo(
    () => ({ start: range.start, end: range.end, padTop: range.padTop, padBottom: range.padBottom, revealRow }),
    [range, revealRow],
  );
}
