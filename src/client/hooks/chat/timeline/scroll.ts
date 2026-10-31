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
    jumpCountRef.current += 1;
    // The click that starts a jump is not a scroll input: the reader has not
    // taken the viewport back, so a clamp right after this must not cancel it.
    readerInputAtRef.current = Number.NEGATIVE_INFINITY;
    landing().start();
    pinToBottom(behavior);
  }, [landing, pinToBottom]);

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
    const container = scrollNode;
    let frame: number | null = null;
    const observer = new ResizeObserver(() => {
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        // A jump in flight owns the position: its watch re-aims at the tail
        // itself, and a pin from here would replace a smooth landing with an
        // instant snap on every measurement along the way.
        if (followRef.current && !jumpActiveRef.current) pinToBottom('instant');
        syncFollowBottom();
      });
    });
    if (container) observer.observe(container);
    if (contentNode) observer.observe(contentNode);
    return () => {
      observer.disconnect();
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [contentNode, scrollNode, pinToBottom, syncFollowBottom]);

  // What counts as the reader having taken the viewport back, for
  // `handleScroll`'s upward-scroll test. Wired on the scroller NODE (state, not
  // the ref — the surface is swapped in a commit late), because a wheel, a
  // finger or a key only ever arrives there.
  useEffect(() => {
    if (!scrollNode) return;
    const note = () => {
      readerInputAtRef.current = performance.now();
    };
    const types = ['wheel', 'touchstart', 'touchmove', 'pointerdown', 'keydown'] as const;
    for (const type of types) scrollNode.addEventListener(type, note, { passive: true });
    return () => {
      for (const type of types) scrollNode.removeEventListener(type, note);
    };
  }, [scrollNode]);

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
    handleScroll,
    scrollToBottom,
    jumpToBottom,
  };
}
