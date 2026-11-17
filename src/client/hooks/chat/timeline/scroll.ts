/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Chat timeline scroll container state (auto-fading scrollbar + follow-bottom
 * affordance). Extracted from useChatTimeline so that hook stays under the
 * repo's per-file size ceiling.
 *
 * The follow-bottom affordance is geometry, not an event: content that grows
 * without the user scrolling (history lands, an accordion expands, an image
 * decodes, the panel is resized) never fires `scroll`. Both the container and
 * the content wrapper are therefore observed, so a session opened at the top
 * shows the button without a single scroll event.
 *
 * Streaming auto-scroll is stick-to-bottom: `scrollToBottom` only actually
 * moves the viewport while `follow` is engaged. The user scrolling away from
 * the tail disengages it (the scroll fight is gone — they can read while the
 * AI generates); scrolling back near the tail, or clicking the scroll-bottom
 * button, re-engages it. Programmatic jumps (`scrollTo`) never flip the mode.
 *
 * `jumpToBottom` is the unconditional bypass (`follow` is re-engaged, geometry
 * is re-baselined, and the paging trigger stands down until the landing
 * settles) — the button's jump, the open-session jump, and the send jump all
 * go through it. `follow` lives across session switches, so an open jump that
 * honoured it was simply refused for a session opened after the user had
 * scrolled up.
 *
 * A jump OWNS the viewport until it has actually landed, the same way
 * `revealRow` owns it while it flies. The timeline mounts a window of its rows
 * and ESTIMATES the rest, so `scrollHeight` changes while a jump mounts the
 * rows it passes over — the target it was issued against is stale before the
 * animation ends. The jump watch therefore re-reads the geometry every frame
 * and re-aims until the viewport has SAT at the tail; the content observer and
 * the row window stand down meanwhile, so no measurement drags the landing
 * back. See `createJumpLanding` for what each state means.
 */

import type { RefObject } from 'preact/compat';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { createJumpLanding, type JumpLanding } from '@/client/hooks/chat/timeline/jump-landing';
import { useReaderInputStamp } from '@/client/hooks/chat/timeline/reader-input';
import { useTimelineGeometryPin } from '@/client/hooks/chat/timeline/scroll-geometry';

/** Distance from the tail, in pixels, that still counts as "at the bottom". */
const FOLLOW_BOTTOM_THRESHOLD_PX = 100;

/**
 * How much further back the reader must be for a phone composer to give its
 * height back, on top of {@link FOLLOW_BOTTOM_THRESHOLD_PX}.
 *
 * This is hysteresis, and it is load-bearing: shrinking the composer grows the
 * scroller's viewport by the height it gave back (68 → 44px, i.e. 24px), which
 * by itself moves the reader 24px CLOSER to the tail. Without the margin a
 * reader sitting just past the threshold would shrink the box, land inside the
 * threshold, restore it, and land outside it again — a loop that re-renders the
 * composer forever. The margin exceeds the give-back, so a compaction can never
 * cross back over the restore threshold on its own.
 */
const COMPACT_TRIGGER_PX = FOLLOW_BOTTOM_THRESHOLD_PX + 64;

/** How long after a wheel/touch/pointer/key event an upward scroll still
 *  counts as the READER's. Only consulted while a jump is landing: a layout
 *  clamp moves `scrollTop` up with nobody behind it, and treating that as the
 *  reader taking the viewport back is what cancelled a jump mid-flight. */
const READER_INPUT_WINDOW_MS = 600;

export interface ChatTimelineScrollOptions {
  /** Called when the viewport reaches the top (history paging trigger).
   *  Ref-indirect; the hook never depends on the callback's identity. */
  onScrollTop?: () => void;
}

export interface ChatTimelineScrollResult {
  scrollRef: RefObject<HTMLDivElement>;
  /**
   * The scroller node as STATE. A consumer that must SUBSCRIBE to it (a
   * `scroll` listener, a ResizeObserver) keys its effect on this, never on
   * `scrollRef`: the surface is swapped in after the full-panel skeleton and
   * again on a session switch, and a ref identity never changes, so an effect
   * keyed on the ref subscribes to whichever node existed on its first run —
   * or to none, when that run happened before the scroller mounted.
   */
  scrollNode: HTMLDivElement | null;
  /**
   * Ref callback for the scroller. Use this INSTEAD of `scrollRef` in the
   * element's `ref`: it keeps the ref current AND publishes the node as
   * {@link scrollNode}, so subscribing consumers re-run when the surface is
   * swapped.
   */
  scrollNodeRef: (node: HTMLDivElement | null) => void;
  /** Attach to the timeline's inner content wrapper so its growth is observed. */
  contentRef: (node: HTMLDivElement | null) => void;
  showScrollBottom: boolean;
  /**
   * The reader is back through the transcript, with hysteresis: it engages
   * further from the tail than {@link showScrollBottom} does and releases at
   * the same distance, so a surface that CHANGES SIZE in response cannot
   * oscillate around the threshold. A phone composer uses it to give its height
   * back to the conversation.
   */
  readingBack: boolean;
  /** Streaming auto-scroll gates on this: pinned to the tail = true. */
  followRef: RefObject<boolean>;
  /** Bottom jumps issued so far. A paging request stamps its viewport anchor
   *  with this and drops the anchor once it has moved on — otherwise a window
   *  that lands AFTER the user asked for the tail writes `scrollTop` straight
   *  over the jump (reproduced: the jump stopped ~26k px short of the tail and
   *  only the next click reached it, once no window was left to page in). */
  jumpCountRef: RefObject<number>;
  /** True while a bottom jump is landing: the jump owns the viewport, so
   *  history paging stands down and neither the content observer nor the row
   *  window writes a position under it. Released once the viewport has SAT at
   *  the tail (see `createJumpLanding`), never on a fixed timer. */
  jumpActiveRef: RefObject<boolean>;
  /**
   * The motion of the jump in flight (`jumpToBottom`'s own argument).
   *
   * The row window's correction is INSTANT, so it may write under an instant
   * jump — both writers aim at the same tail, and the correction lands in the
   * commit that measured the rows, before the browser paints. Under a SMOOTH
   * jump it must stand down, or the correction replaces the animation with a
   * snap. Without this distinction the open jump painted one frame at the
   * estimate's bottom (measured: 2 044 px short) and only the next frame's
   * rAF reached the tail.
   */
  jumpBehaviorRef: RefObject<ScrollBehavior>;
  handleScroll: () => void;
  scrollToBottom: (behavior?: ScrollBehavior) => void;
  /** Jump to the tail and re-engage follow mode (scroll-bottom button, the
   *  session-open jump, the post-send jump). */
  jumpToBottom: (behavior?: ScrollBehavior) => void;
}

/** Distance from the top that counts as "reached the history boundary". */
const SCROLL_TOP_TRIGGER_PX = 40;

export function useChatTimelineScroll(options: ChatTimelineScrollOptions = {}): ChatTimelineScrollResult {
  const onScrollTopRef = useRef<(() => void) | undefined>(options.onScrollTop);
  onScrollTopRef.current = options.onScrollTop ?? onScrollTopRef.current;
  const scrollRef = useRef<HTMLDivElement>(null);
  // The scroller NODE as state, not only as a ref. The surface is swapped in
  // after the full-panel skeleton (and again on every session switch that
  // clears the timeline), so a consumer that subscribes once from a ref is
  // subscribed to a node that was detached a commit later — see
  // `useTimelineRowWindow`, where that left the mounted window frozen at the
  // head of a session while the viewport sat at its tail.
  const [scrollNode, setScrollNode] = useState<HTMLDivElement | null>(null);
  const scrollNodeRef = useCallback((node: HTMLDivElement | null) => {
    scrollRef.current = node;
    setScrollNode(node);
  }, []);
  const [contentNode, setContentNode] = useState<HTMLDivElement | null>(null);
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  // Hysteretic twin of `showScrollBottom` (see `ChatTimelineScrollResult`): it
  // engages past `COMPACT_TRIGGER_PX` and releases at
  // `FOLLOW_BOTTOM_THRESHOLD_PX`, so a consumer that resizes itself in
  // response cannot flip the flag back and forth.
  const [readingBack, setReadingBack] = useState(false);
  // True while the viewport is (or should stay) pinned to the tail. A ref, not
  // state: scroll chunks read it every frame and a flip must not re-render.
  const followRef = useRef(true);
  // Previous scrollTop, for upward-scroll detection in handleScroll.
  const lastScrollTopRef = useRef(0);
  // Bottom-jump bookkeeping; see ChatTimelineScrollResult for each ref.
  const jumpCountRef = useRef(0);
  const jumpActiveRef = useRef(false);
  // The motion of the jump in flight; see ChatTimelineScrollResult.
  const jumpBehaviorRef = useRef<ScrollBehavior>('smooth');
  // The landing watch: owns the viewport until the jump has landed.
  const landingRef = useRef<JumpLanding | null>(null);
  // Last time the READER touched the scroller (wheel, touch, pointer, key).
  // `scrollTop` moving up is not enough to tell them from a layout clamp.
  // `-Infinity`, not `0`: the window is compared against `performance.now()`,
  // which starts near zero, so a zero sentinel would read as input on the first
  // moments of a page load.
  const readerInputAtRef = useRef(Number.NEGATIVE_INFINITY);

  const contentRef = useCallback((node: HTMLDivElement | null) => {
    setContentNode(node);
  }, []);

  /** Move the viewport to the tail unconditionally, then re-baseline the
   *  upward-scroll detector. Both matter: `scrollTo` applies the new position
   *  for 'instant', and the previous session's (larger) scrollTop would
   *  otherwise read as the user scrolling UP on the very event this jump
   *  produces — disengaging follow and cancelling a jump in flight. */
  const pinToBottom = useCallback((behavior: ScrollBehavior) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
    lastScrollTopRef.current = el.scrollTop;
  }, []);

  const syncFollowBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    setShowScrollBottom(distance >= FOLLOW_BOTTOM_THRESHOLD_PX);
    // Two thresholds, one direction each: engaged further back, released at
    // the tail. The setter is called with the SAME value on every scroll that
    // does not cross one of them, and React bails out of that render.
    setReadingBack((wasReading) => (wasReading ? distance >= FOLLOW_BOTTOM_THRESHOLD_PX : distance >= COMPACT_TRIGGER_PX));
  }, []);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (el) {
      // Disengage only on upward scroll (the user reading back): a decreasing
      // scrollTop is the one signal that separates a user's intent from the
      // programmatic downward scrolls — smooth follow animations produce only
      // increasing scrollTop, so a geometry check alone would flip the flag
      // mid-animation as content outgrows the animation. Re-engage whenever
      // the viewport is back near the tail, whichever way it got there.
      if (el.scrollTop < lastScrollTopRef.current - 1) {
        // An upward move is not automatically the reader's: the row window
        // replacing estimates with measured heights CLAMPS `scrollTop` up, and
        // while a jump is landing that clamp used to cancel the jump outright —
        // the animation stopped mid-flight, the button stayed up, and only the
        // next click (or scrolling the rest of the way by hand) reached the
        // tail. While the guard is up, only real input takes the viewport back.
        const reader = performance.now() - readerInputAtRef.current < READER_INPUT_WINDOW_MS;
        if (!jumpActiveRef.current || reader) {
          followRef.current = false;
          jumpActiveRef.current = false;
        }
      }
      if (el.scrollHeight - el.scrollTop - el.clientHeight < FOLLOW_BOTTOM_THRESHOLD_PX) followRef.current = true;
      lastScrollTopRef.current = el.scrollTop;
      // History paging: the viewport hit the top — ask for the older window.
      // Idempotent: the loader ignores calls while a page is in flight.
      if (el.scrollTop <= SCROLL_TOP_TRIGGER_PX) onScrollTopRef.current?.();
    }
    syncFollowBottom();
  }, [syncFollowBottom]);

  /** The landing watch, created on first use. Lazily, because the open-session
   *  jump runs from a LAYOUT effect — before this hook's own passive effects —
   *  and a watch created there must not be replaced by a second one later. */
  const landing = useCallback((): JumpLanding => {
    landingRef.current ??= createJumpLanding({ scrollRef, jumpActiveRef, pinToBottom });
    return landingRef.current;
  }, [pinToBottom]);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    // Follow-gated: a stream chunk in read mode (user scrolled away) must not
    // yank the viewport down. jumpToBottom is the explicit bypass.
    if (!followRef.current) return;
    pinToBottom(behavior);
  }, [pinToBottom]);

  const jumpToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    if (!scrollRef.current) return;
    followRef.current = true;
    jumpActiveRef.current = true;
    jumpBehaviorRef.current = behavior;
    jumpCountRef.current += 1;
    // The click that starts a jump is not a scroll input: the reader has not
    // taken the viewport back, so a clamp right after this must not cancel it.
    readerInputAtRef.current = Number.NEGATIVE_INFINITY;
    landing().start(behavior);
    pinToBottom(behavior);
  }, [landing, pinToBottom]);

  // Geometry, not events: see `scroll-geometry.ts` for the two timings.
  useTimelineGeometryPin({
    scrollNode,
    contentNode,
    followRef,
    jumpActiveRef,
    pinToBottom,
    syncFollowBottom,
  });

  // What counts as the reader having taken the viewport back, for
  // `handleScroll`'s upward-scroll test (see `reader-input.ts`).
  useReaderInputStamp(scrollNode, readerInputAtRef);

  useEffect(() => () => {
    landingRef.current?.stop();
  }, []);

  return {
    scrollRef,
    scrollNodeRef,
    scrollNode,
    contentRef,
    showScrollBottom,
    readingBack,
    followRef,
    jumpCountRef,
    jumpActiveRef,
    jumpBehaviorRef,
    handleScroll,
    scrollToBottom,
    jumpToBottom,
  };
}
