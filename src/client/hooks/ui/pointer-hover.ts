/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Hover state for a hairline handle, driven by pointer events instead of
 * `:hover`.
 *
 * A CSS `:hover` on a 3px separator can stay applied after the pointer has
 * left it: the browser recomputes the pseudo-class on the next pointer move,
 * and a handle that moves under the cursor (a panel width transition, a drag
 * overlay that covers the viewport) leaves the stale state behind. The
 * reported symptom is a line that stays lit until the pointer is moved back
 * over it and away again.
 *
 * `pointerenter`/`pointerleave` are events, not a pseudo-class, so they are
 * dispatched from the same hit test that decides the hover. The document
 * `pointermove` listener is the correction for both directions: it sets the
 * state to whether the point is inside the handle's rect, so a missed leave
 * (the pointer entered an iframe, the window lost focus, a drag ended outside
 * the window) clears, and a handle that moved under a stationary pointer
 * lights on the next move. It runs on every move — one rect read per handle,
 * at most once per frame — because gating it on the current state is what
 * would leave the inverse glitch (a handle under the pointer that never got
 * its `pointerenter`).
 */
import { useEffect, useState } from 'preact/hooks';
import type { RefObject } from 'preact';

export function usePointerHover(ref: RefObject<HTMLElement | null>): boolean {
  const [hovered, setHovered] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const enter = () => setHovered(true);
    const leave = () => setHovered(false);
    element.addEventListener('pointerenter', enter);
    element.addEventListener('pointerleave', leave);

    const syncToPointer = (event: PointerEvent) => {
      const rect = element.getBoundingClientRect();
      setHovered(
        event.clientX >= rect.left &&
          event.clientX <= rect.right &&
          event.clientY >= rect.top &&
          event.clientY <= rect.bottom,
      );
    };
    document.addEventListener('pointermove', syncToPointer, true);

    return () => {
      element.removeEventListener('pointerenter', enter);
      element.removeEventListener('pointerleave', leave);
      document.removeEventListener('pointermove', syncToPointer, true);
    };
  }, [ref]);

  return hovered;
}
