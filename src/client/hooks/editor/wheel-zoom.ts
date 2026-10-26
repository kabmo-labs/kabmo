/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Ctrl/⌘ + wheel zoom, wired to the editor's own scroller.
 *
 * `ctrlKey` rather than a bare wheel: a bare wheel over the editor must SCROLL, and a
 * zoom that took it would make the document unscrollable. macOS reports a trackpad
 * pinch as `ctrlKey + wheel` (the platform's own convention), so this also gives
 * pinch-to-zoom for free.
 *
 * ## It must not fire over a nested scroller
 *
 * The find bar and a composer popup are real scroll containers inside the panel. A
 * wheel there belongs to them, so the handler walks up from the event target and
 * stands down for any ancestor that scrolls — otherwise scrolling a long list of
 * search hits would resize the code underneath it.
 *
 * ## The bounds are the SHARED ones
 *
 * `EDITOR_MIN_FONT_SIZE` / `EDITOR_MAX_FONT_SIZE` are what the toolbar's buttons and
 * the phone's slider clamp to. A wheel that used its own range would be a second
 * answer to "how small can the text get".
 */

import { useEffect } from 'preact/hooks';

import { EDITOR_MAX_FONT_SIZE, EDITOR_MIN_FONT_SIZE } from '@/shared/lib/code/editor/typography';

/** Wheel delta → one zoom step. A trackpad sends many small deltas; a mouse sends ±100. */
export function zoomStepsFromWheel(deltaY: number): number {
  if (deltaY === 0) return 0;
  // `sign` rather than a magnitude threshold: a pinch sends ±1…±10 and a mouse ±100,
  // and both should be one step per gesture tick. Capped so a fast fling cannot jump
  // several sizes at once.
  return Math.max(-1, Math.min(1, -Math.sign(deltaY)));
}

/** The next font size, clamped to the shared bounds. */
export function clampZoom(current: number, steps: number, min = EDITOR_MIN_FONT_SIZE, max = EDITOR_MAX_FONT_SIZE): number {
  return Math.max(min, Math.min(max, current + steps));
}

/**
 * Whether the event target sits inside a scroller of its own, between it and `host`.
 *
 * A node that scrolls its own content owns the wheel: resizing the code underneath a
 * scrolling list is the failure this prevents.
 */
export function isInsideNestedScroller(target: EventTarget | null, host: HTMLElement): boolean {
  let node = target instanceof HTMLElement ? target : null;
  while (node && node !== host) {
    const style = getComputedStyle(node);
    if (/(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight) return true;
    node = node.parentElement;
  }
  return false;
}

/**
 * Attach the zoom listener to a scroller.
 *
 * `element` is CodeMirror's own `scrollDOM` (reported through the surface's
 * `onScroller`), which appears only once the view mounts — so this re-arms on the
 * render it arrives in rather than capturing a ref that was null at mount.
 */
export function useWheelZoom(
  element: HTMLElement | null,
  setZoomLevel: (update: (current: number) => number) => void,
): void {
  useEffect(() => {
    if (!element) return;
    // The HOST is the surface, not the scroller: a nested scroller is an ancestor of
    // the event target and a descendant of the host, so the walk needs both ends.
    const host = element.closest('[data-code-surface]');
    const stop = host instanceof HTMLElement ? host : element;

    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      // The browser's own page zoom is what this gesture means by default, and it
      // would scale the whole console instead of the document.
      event.preventDefault();
      if (isInsideNestedScroller(event.target, stop)) return;
      const steps = zoomStepsFromWheel(event.deltaY);
      if (steps === 0) return;
      setZoomLevel((current) => clampZoom(current, steps));
    };

    // `passive: false` is required: a passive listener cannot `preventDefault`, and
    // the browser would zoom the page instead.
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [element, setZoomLevel]);
}
