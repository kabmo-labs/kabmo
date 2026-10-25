/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Whether a file drag is currently over a drop target — the one rule every
 * overlay in the app asks.
 *
 * The counter this replaces was the bug. `dragenter`/`dragleave` fire for every
 * nested child the pointer crosses, so both hooks counted them, and the counts
 * did NOT cancel: `dragleave` was ignored when its `relatedTarget` was still
 * inside the element (a move between children), while `dragenter` incremented
 * unconditionally. Every child crossing therefore raised the counter by one and
 * only a full exit lowered it by one — so after sweeping across a few message
 * rows the counter was already 4, and leaving the panel brought it to 3. The
 * overlay stayed on with the pointer nowhere near the target (measured in
 * Chromium: five child crossings, one exit, overlay still drawn).
 *
 * `relatedTarget` answers the question directly and symmetrically, so there is
 * no count to drift:
 *
 * - A `dragleave` whose `relatedTarget` is still inside the element is a move
 *   between children — the pointer never left, so the overlay stays.
 * - Every other `dragleave` is a real exit, and `relatedTarget` is null when the
 *   pointer left the window, which is exactly the case a counter could not
 *   distinguish from a missed event.
 *
 * The window listeners are the backstop for a gesture that ends without ever
 * reaching the element again: an in-app drag released over another surface
 * bubbles a `drop`, and an in-app drag cancelled with Escape fires `dragend` on
 * its source. An OS file drag has neither (its source is outside the browser),
 * which is why the element's own `dragleave` is the primary signal and these
 * only clear what it could not.
 *
 * **A cancelled OS drag therefore sends nothing at all**, and that is the case
 * that left the overlay on screen after the user pressed Escape: measured in
 * Chromium, an Escape during a real file drag delivered no `dragleave`, no
 * `dragend` and no `keydown` to the page. The recovery signal is the POINTER:
 * a native drag swallows `pointermove`/`mousemove` for its whole duration
 * (measured — three dispatched moves during an active drag produced none), and
 * they resume the instant it ends, so a move carrying no held button means no
 * drag can be in progress. That also covers a drag released outside the window.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { TargetedDragEvent } from 'preact';

export interface DragPresence {
  /** True while a file drag hovers the element. Drives the overlay. */
  active: boolean;
  /** The pointer is over the element: entered it, or moved back onto it. */
  enter: () => void;
  /** A `dragleave` — clears only when the pointer actually left. */
  leave: (event: TargetedDragEvent<HTMLElement>) => void;
  /** The gesture is over here, or a descendant claimed it. */
  clear: () => void;
}

export function useDragPresence(): DragPresence {
  const [active, setActive] = useState(false);
  // Read by the window backstops, which are bound once and must not be
  // re-attached on every hover.
  const activeRef = useRef(false);
  const set = useCallback((next: boolean) => {
    activeRef.current = next;
    setActive(next);
  }, []);

  const enter = useCallback(() => set(true), [set]);
  const clear = useCallback(() => set(false), [set]);

  const leave = useCallback((event: TargetedDragEvent<HTMLElement>) => {
    // `currentTarget` is the element the handler is bound to, which is the
    // question: is the pointer still inside THIS target's subtree?
    const target = event.currentTarget;
    const related = event.relatedTarget;
    if (target && related instanceof Node && target.contains(related)) return;
    set(false);
  }, [set]);

  useEffect(() => {
    window.addEventListener('drop', clear);
    window.addEventListener('dragend', clear);
    return () => {
      window.removeEventListener('drop', clear);
      window.removeEventListener('dragend', clear);
    };
  }, [clear]);

  // The cancelled-OS-drag recovery. A drag is performed with a button held, and
  // a native drag suppresses pointer movement entirely, so a move with NO
  // buttons held can only happen after the gesture is over. Guarded on `active`
  // so an idle page pays one boolean read per move and no re-render.
  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      if (!activeRef.current) return;
      if (event.buttons !== 0) return;
      set(false);
    };
    window.addEventListener('pointermove', onMove);
    return () => window.removeEventListener('pointermove', onMove);
  }, [set]);

  // Memoised so a caller can depend on the object without rebuilding its own
  // handlers every render — both callers spread these into props.
  return useMemo(() => ({ active, enter, leave, clear }), [active, enter, leave, clear]);
}
