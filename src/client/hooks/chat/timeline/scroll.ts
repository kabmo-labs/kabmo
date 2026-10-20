/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
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
 * is re-baselined, and the paging trigger stands down for a moment) — the
 * button's jump, the open-session jump, and the send jump all go through it.
 * `follow` lives across session switches, so an open jump that honoured it was
 * simply refused for a session opened after the user had scrolled up.
 */

import type { RefObject } from 'preact/compat';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';

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

/** How long a bottom jump counts as settling. The scroll handler reads "the
 *  viewport is at the top, fetch older history" from geometry, and a jump that
 *  STARTS at the top (the button, on a session scrolled back to its head)
 *  passes through those first pixels — so the paging trigger stands down for
 *  the jump's duration instead of paging a window the jump must then outrun. */
const JUMP_SETTLE_MS = 1000;

export interface ChatTimelineScrollOptions {
  /** Called when the viewport reaches the top (history paging trigger).
   *  Ref-indirect; the hook never depends on the callback's identity. */
  onScrollTop?: () => void;
}

export interface ChatTimelineScrollResult {
  scrollRef: RefObject<HTMLDivElement>;
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
  /** True while a bottom jump is settling ({@link JUMP_SETTLE_MS}); history
   *  paging stands down meanwhile. */
  jumpActiveRef: RefObject<boolean>;
  handleScroll: () => void;
  scrollToBottom: (behavior?: ScrollBehavior) => void;
  /** Jump to the tail and re-engage follow mode (scroll-bottom button, the
   *  session-open jump, the post-send jump). */
  jumpToBottom: (behavior?: ScrollBehavior) => void;
}

/** Distance from the top that counts as "reached the history boundary". */
const SCROLL_TOP_TRIGGER_PX = 40;

/** Pending timeout handle. Named here rather than re-derived per ref because
 *  the DOM and Bun/Node typings disagree on what `setTimeout` returns. */
type TimeoutHandle = ReturnType<typeof setTimeout>;

export function useChatTimelineScroll(options: ChatTimelineScrollOptions = {}): ChatTimelineScrollResult {
  const onScrollTopRef = useRef<(() => void) | undefined>(options.onScrollTop);
  onScrollTopRef.current = options.onScrollTop ?? onScrollTopRef.current;
  const scrollRef = useRef<HTMLDivElement>(null);
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
  const jumpTimerRef = useRef<TimeoutHandle>();

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
        followRef.current = false;
        // The user took the viewport back: a jump still settling must not keep
        // re-pinning the tail under them.
        jumpActiveRef.current = false;
      }
      if (el.scrollHeight - el.scrollTop - el.clientHeight < FOLLOW_BOTTOM_THRESHOLD_PX) followRef.current = true;
      lastScrollTopRef.current = el.scrollTop;
      // History paging: the viewport hit the top — ask for the older window.
      // Idempotent: the loader ignores calls while a page is in flight.
      if (el.scrollTop <= SCROLL_TOP_TRIGGER_PX) onScrollTopRef.current?.();
    }
    syncFollowBottom();
  }, [syncFollowBottom]);

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
    jumpCountRef.current += 1;
    clearTimeout(jumpTimerRef.current);
    jumpTimerRef.current = setTimeout(() => { jumpActiveRef.current = false; }, JUMP_SETTLE_MS);
    pinToBottom(behavior);
  }, [pinToBottom]);

  // Geometry, not events: content that grows without the user scrolling
  // (history prepending, an accordion expanding, an image decoding, a late
  // Shiki/mermaid layout, the panel resizing) never fires `scroll`, so nothing
  // else notices the tail moving away. While the viewport is pinned that growth
  // is exactly when to re-pin it — a prepended window shifts the tail down by
  // its own height, which strands a jump target measured a frame earlier (and
  // a one-shot open jump by anything that lays out late). Unpinned (the user
  // reading back) nothing is touched: the prepend anchor owns the position.
  //
  // `contentNode` is a dep so the observer is rebuilt when the timeline mounts
  // — a session picked from the workspace picker swaps the whole subtree in,
  // and the callback ref fires before this effect, so the node is always
  // available here.
  //
  // The pin is DEFERRED to the next frame, and that is a correctness
  // requirement, not a tuning choice. `pinToBottom` assigns `scrollTop`, which
  // is a layout write — and a layout write made from INSIDE a delivery is what
  // makes the browser re-run the observers within the same frame. It does that
  // until it hits its per-frame depth limit, then reports
  // "ResizeObserver loop completed with undelivered notifications." — measured
  // here: a panel-width transition burst delivered 34 times over 18 frames with
  // 18 of those deliveries writing `scrollTop`, and 13 frames saw the observer
  // run twice. The report is not cosmetic: an uncaught page error raises Bun's
  // dev-client "Runtime Error" overlay (z-index 2147483647) over the whole app,
  // so resizing a panel could cover the UI with a warning about the timeline's
  // own auto-scroll. Deferring also coalesces a burst into ONE write instead of
  // one per delivery. The delay is invisible: the growth this reacts to is a
  // layout that has already been painted, and the rAF runs before the next
  // paint.
  //
  // `syncFollowBottom` only sets state, but it runs in the same deferred tick
  // so the affordance and the pin always describe the same geometry.
  useEffect(() => {
    syncFollowBottom();
    if (typeof ResizeObserver === 'undefined') return;
    const container = scrollRef.current;
    let frame: number | null = null;
    const observer = new ResizeObserver(() => {
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        if (followRef.current) pinToBottom('instant');
        syncFollowBottom();
      });
    });
    if (container) observer.observe(container);
    if (contentNode) observer.observe(contentNode);
    return () => {
      observer.disconnect();
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [contentNode, pinToBottom, syncFollowBottom]);

  useEffect(() => () => {
    clearTimeout(jumpTimerRef.current);
  }, []);

  return {
    scrollRef,
    contentRef,
    showScrollBottom,
    readingBack,
    followRef,
    jumpCountRef,
    jumpActiveRef,
    handleScroll,
    scrollToBottom,
    jumpToBottom,
  };
}
