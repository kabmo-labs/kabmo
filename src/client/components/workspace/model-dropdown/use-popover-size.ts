/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The model popover's measured box, re-measured on every event that moves it.
 *
 * MEASURED, not a constant, and not measured once. A window resize alone missed
 * the two events that actually move the trigger — the composer GROWING as the
 * user types (which lifts it) and a phone's visual viewport shrinking under the
 * keyboard. Measured at 1024x576, a fixed-height cap put the harness tab strip at
 * y=16, under the titlebar, and `elementFromPoint` on the first tab answered the
 * HEADER: the strip was in the DOM and unreachable by pointer.
 *
 * The arithmetic itself lives in `popover-metrics.ts`, so the cases can be
 * asserted without a layout engine; this hook is only the observers.
 */

import { useLayoutEffect, useState } from 'preact/hooks';
import type { RefObject } from 'preact/compat';
import { popoverMetrics, type PopoverSize } from '@/client/components/workspace/model-dropdown/popover-metrics';

/**
 * @param panelRef the card. Its nearest `[data-model-dropdown-root]` is the
 *   trigger the card grows upward from, and that trigger's nearest
 *   `[data-composer-style]` is the PANEL the card must stay inside.
 */
export function usePopoverSize(panelRef: RefObject<HTMLElement>): PopoverSize {
  // The FIRST frame's size, before the layout effect measures anything. Taken
  // from `popoverMetrics` rather than written out again, so the caps are stated
  // once and a stale pair here cannot flash a card the rule would not allow.
  const [size, setSize] = useState<PopoverSize>(() => popoverMetrics({
    triggerTop: Number.POSITIVE_INFINITY,
    anchorLeft: 0,
    containerRight: Number.POSITIVE_INFINITY,
    viewportWidth: Number.POSITIVE_INFINITY,
    viewportTop: 0,
  }));

  useLayoutEffect(() => {
    // The TRIGGER's box, not the card's: the card grows upward from the trigger,
    // so measuring the card would feed its own height back into the cap.
    const anchorEl = panelRef.current?.closest('[data-model-dropdown-root]') ?? null;
    if (!anchorEl) return;
    const containerEl = anchorEl.closest('[data-composer-style]');

    const measure = () => {
      const anchor = anchorEl.getBoundingClientRect();
      // The COMPOSER CARD's right EDGE, not its width and not the chip: the card
      // starts at `anchor.left` and must not spill past that edge. A chip
      // shrink-wraps its label (measured 259px inside a 712px composer), and a
      // width says nothing about how much of it lies to the right of the anchor —
      // which is how a 437px card came to hang 29px past a 421px composer.
      const container = containerEl?.getBoundingClientRect();
      const next = popoverMetrics({
        triggerTop: anchor.top,
        anchorLeft: anchor.left,
        containerRight: container?.right ?? window.innerWidth,
        viewportWidth: window.visualViewport?.width ?? window.innerWidth,
        // Non-zero while a phone keyboard is up: the visible area starts lower,
        // which is exactly the space the card would otherwise run behind.
        viewportTop: Math.max(0, window.visualViewport?.offsetTop ?? 0),
      });
      setSize((prev) => (prev.width === next.width && prev.height === next.height ? prev : next));
    };

    measure();
    window.addEventListener('resize', measure);
    window.visualViewport?.addEventListener('resize', measure);
    window.visualViewport?.addEventListener('scroll', measure);
    // Both boxes move independently: the trigger lifts when the textarea grows or
    // the toolbar rewraps, and the panel widens when the sidebar is dragged.
    // Observing only the trigger left the card at its old width until the next
    // window resize.
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    observer?.observe(anchorEl);
    if (containerEl) observer?.observe(containerEl);

    return () => {
      window.removeEventListener('resize', measure);
      window.visualViewport?.removeEventListener('resize', measure);
      window.visualViewport?.removeEventListener('scroll', measure);
      observer?.disconnect();
    };
  }, [panelRef]);

  return size;
}
