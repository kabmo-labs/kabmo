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
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { layoutTimelineRows, rowIndex, timelineWindow } from '@/shared/lib/chat/timeline/row-window';
import { createRevealRow, writeScrollTop } from '@/client/hooks/chat/timeline/row-window-reveal';

/** A measurement is only adopted when it differs by more than this. */
const MEASURE_EPSILON_PX = 0.5;

/** Distance from the bottom, in px, that makes a reader "at the tail". Mirrors
 *  `FOLLOW_BOTTOM_THRESHOLD_PX` in `scroll.ts`: below it, follow mode is on. */
const TAIL_ANCHOR_PX = 100;

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
  /** The scroll hook's bottom-jump guard. While a jump to the tail is landing
   *  it OWNS the position: this hook still adopts measurements and still
   *  re-lays the window, but writes no `scrollTop` — a correction written under
   *  the animation drags the viewport back and the jump has to be re-aimed,
   *  which is what reads as the button "jumping in pieces". */
  jumpActiveRef?: RefObject<boolean>;
  /** The scroll hook's bottom-jump counter. A new value means the reader asked
   *  for the TAIL, so this hook claims the tail pin: without it the very next
   *  measurement wrote the OLD reading anchor back over the landing (measured:
   *  the jump reached the bottom and the correction pulled the viewport
   *  2 000 px back up, 217 px short of the tail once the stream grew again). */
  jumpCountRef?: RefObject<number>;
  /** False renders every row (a short list, or a surface without a scroller). */
  enabled?: boolean;
}

export function useTimelineRowWindow({
  ids,
  scrollRef,
  scrollNode,
  jumpActiveRef,
  jumpCountRef,
  enabled = true,
}: UseTimelineRowWindowDeps): TimelineRowWindow {
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
  // Bottom jumps this hook has already claimed for the tail. A new count means
  // the reader asked for the BOTTOM, so the tail pin belongs on: without it the
  // next measurement corrected the viewport back to the reading anchor it had
  // before the jump, and the landing was undone the moment the jump settled.
  const seenJumpCountRef = useRef(jumpCountRef?.current ?? 0);
  useLayoutEffect(() => {
    const count = jumpCountRef?.current ?? 0;
    if (count === seenJumpCountRef.current) return;
    seenJumpCountRef.current = count;
    tailPinRef.current = true;
  });

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
  /**
   * A reveal is flying: it re-writes its target every frame until it settles,
   * so a measurement must not correct the position underneath it (the two
   * would trade the viewport). See `adopt`.
   */
  const revealingRef = useRef(false);

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
      // Which row the reader is looking at, under the geometry they are still
      // seeing: `el.scrollTop` has not moved yet (a browser does not adjust it
      // when content above grows), so the OLD layout is the right one to read
      // the anchor from.
      const current = timelineWindow(layout, el.scrollTop, el.clientHeight, 0);
      const anchorId = ids[current.start];
      // A reader parked at the tail follows the TAIL, not the row that happened
      // to be at the top of the viewport: the rows below it are estimates until
      // they mount, so a row anchor would leave the viewport short of the
      // bottom — measured at 775 px on an opened session, which is past the
      // 100 px threshold that decides whether the stream keeps following.
      // Measured against the PREVIOUS layout, not the DOM: this effect runs
      // after the content already grew, so the DOM's own distance is the
      // growth itself. A reader who was at the bottom before a row was measured
      // taller must stay at the bottom — measured against the DOM they were
      // left 2 080 px short, i.e. outside follow mode.
      // A jump to the tail is a claim about the BOTTOM, exactly like a reveal
      // of the last row: mid-flight the viewport is far from it, so the
      // geometry test below would read "reading back" and clear the claim the
      // jump just made.
      const tail = tailPinRef.current
        || Boolean(jumpActiveRef?.current)
        || layout.total - scrollTop - (viewport || el.clientHeight) <= TAIL_ANCHOR_PX;
      const offset = anchorId ? el.scrollTop - layout.offsets[current.start] : 0;

      // The correction is written HERE, against the new layout, not deferred to
      // an effect that runs after this commit. Deferring it is what made an
      // expanded thinking block snap shut: the restore effect for the SAME
      // commit still holds the pre-measurement layout, so it consumed the
      // anchor and wrote the reader's old offset; the next commit then had no
      // anchor left, `scrollTop` was still stale, and the mounted WINDOW moved
      // one row — unmounting and remounting the rows at its edge (measured in
      // the browser: three rows removed and re-added per expand), which throws
      // away every block's local state.
      const next = layoutTimelineRows(ids, measuredRef.current);
      const target = tail || !anchorId
        ? Math.max(0, el.scrollHeight - el.clientHeight)
        : next.offsets[rowIndex(ids, anchorId)] + offset;
      tailPinRef.current = tail;
      // A reveal OWNS the viewport until it settles: it re-writes its target
      // every frame, so a correction here would be written back over it and the
      // two would trade the viewport (measured before this guard existed: the
      // reveal and the restore alternated `0` and its target for the whole
      // animation). A bottom JUMP owns it for the same reason. The measurement
      // is still adopted; only the position waits.
      if (!revealingRef.current && !jumpActiveRef?.current) {
        setScrollTop(target);
        writeScrollTop(el, target);
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
    const el = element;
    if (!el || !tailPinRef.current) return;
    // A jump to the tail owns the position while it lands; its own watch is
    // what puts the viewport at the bottom, and a second writer here is a
    // second animation.
    if (jumpActiveRef?.current) return;
    // The tail pin outlives a commit: the rows above it are estimates until
    // they mount, so every measurement can move the bottom by its own error.
    // The bottom edge is the anchor. `writeScrollTop`, because the container
    // carries `scroll-smooth`: a bare `scrollTop` assignment animates, and a
    // correction that animates is a correction that arrives late.
    writeScrollTop(el, Math.max(0, el.scrollHeight - el.clientHeight));
  }, [layout, element, jumpActiveRef]);

  const revealRow = useMemo(
    () => createRevealRow({ scrollRef, idsRef, layoutRef, viewportRef, tailPinRef, revealingRef, generationRef: revealGenerationRef }),
    [scrollRef],
  );

  return useMemo(
    () => ({ start: range.start, end: range.end, padTop: range.padTop, padBottom: range.padBottom, revealRow }),
    [range, revealRow],
  );
}
