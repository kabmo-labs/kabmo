/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Re-pin the tail when the timeline's GEOMETRY changes, not when it scrolls.
 *
 * Content that grows without the user scrolling (history prepending, an
 * accordion expanding, an image decoding, a late Shiki/mermaid layout, the
 * panel resizing) never fires `scroll`, so nothing else notices the tail moving
 * away. While the viewport is pinned that growth is exactly when to re-pin it —
 * a prepended window shifts the tail down by its own height, which strands a
 * jump target measured a frame earlier (and a one-shot open jump by anything
 * that lays out late). Unpinned (the reader reading back) nothing is touched:
 * the prepend anchor owns the position.
 *
 * Two deliveries, two timings, and the difference is measured:
 *
 * - **CONTENT growth is DEFERRED to the next frame.** `pinToBottom` assigns
 *   `scrollTop`, which is a layout write — and a layout write made from INSIDE
 *   a delivery is what makes the browser re-run its observers within the same
 *   frame. It does that until it hits its per-frame depth limit, then reports
 *   "ResizeObserver loop completed with undelivered notifications." — measured
 *   here: a panel-width transition burst delivered 34 times over 18 frames with
 *   18 of those deliveries writing `scrollTop`, and 13 frames saw the observer
 *   run twice. The report is not cosmetic: an uncaught page error raises Bun's
 *   dev-client "Runtime Error" overlay (z-index 2147483647) over the whole app.
 *   Deferring also coalesces a burst into ONE write instead of one per delivery.
 * - **A CONTAINER height change is pinned IN the delivery.** That is the
 *   composer growing under the timeline, and deferring it paints one frame with
 *   the tail clipped by the growth (measured while typing: the composer grew
 *   7 px, the scroller shrank 7, and the last row's bottom sat 7 px past the
 *   scroller's edge until the next frame's rAF). Writing `scrollTop` cannot
 *   resize the container, so this delivery cannot re-trigger itself.
 *
 * `contentNode` is a dep so the observer is rebuilt when the timeline mounts —
 * a session picked from the workspace picker swaps the whole subtree in, and
 * the callback ref fires before this effect, so the node is always available.
 */

import type { RefObject } from 'preact/compat';
import { useEffect } from 'preact/hooks';

export interface TimelineGeometryPinDeps {
  /** The scroller node as STATE (it is swapped in a commit late). */
  scrollNode: HTMLDivElement | null;
  /** The timeline's inner content wrapper, whose growth is the deferred case. */
  contentNode: HTMLDivElement | null;
  /** Pinned to the tail: growth is re-pinned, reading back is left alone. */
  followRef: RefObject<boolean>;
  /** A jump in flight owns the position; its own watch re-aims. */
  jumpActiveRef: RefObject<boolean>;
  /**
   * The row window measured a row ABOVE the viewport: the content height above
   * the reader changed, and re-pinning the tail would move the viewport by the
   * measured-vs-estimated difference (the reported up/down bounce). Skip one
   * delivery and clear the flag.
   */
  skipTailPinRef: RefObject<boolean>;
  pinToBottom: (behavior: ScrollBehavior) => void;
  /** Re-derives the scroll-bottom affordance from the same geometry. */
  syncFollowBottom: () => void;
}

export function useTimelineGeometryPin({
  scrollNode,
  contentNode,
  followRef,
  jumpActiveRef,
  skipTailPinRef,
  pinToBottom,
  syncFollowBottom,
}: TimelineGeometryPinDeps): void {
  useEffect(() => {
    syncFollowBottom();
    if (typeof ResizeObserver === 'undefined') return;
    const container = scrollNode;
    let frame: number | null = null;
    const observer = new ResizeObserver((entries) => {
      const containerResized = entries.some((entry) => entry.target === container);
      // The row window just measured a row ABOVE the viewport. The content
      // height above the reader changed; re-pinning the tail here would move
      // the viewport by the measured-vs-estimated difference — the reported
      // up/down bounce. The row window already wrote the anchor, so this
      // delivery stands down.
      if (skipTailPinRef.current) {
        skipTailPinRef.current = false;
        syncFollowBottom();
        return;
      }
      if (containerResized && followRef.current && !jumpActiveRef.current) {
        pinToBottom('instant');
        syncFollowBottom();
        return;
      }
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        // A jump in flight owns the position: its pin would replace a smooth
        // landing with an instant snap on every measurement along the way.
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
  }, [contentNode, scrollNode, followRef, jumpActiveRef, skipTailPinRef, pinToBottom, syncFollowBottom]);
}
