/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * True when an element's content is visually cut off by CSS truncation.
 *
 * `text-overflow: ellipsis` hides content at a WIDTH, not at a character count,
 * and the two are unrelated: the same 76-character line fits a 970px desktop
 * timeline and is cut on a 340px phone card. A caller that decides "is there
 * more to show?" from `text.length` therefore renders an ellipsis the user can
 * see and no way to reveal it — the exact failure this hook exists to prevent.
 *
 * `scrollWidth > clientWidth` is the measurement the browser itself uses to
 * decide whether to draw the ellipsis, so it cannot disagree with what is on
 * screen. Three details are load-bearing:
 *
 * - A zero-width element reports 0 for BOTH values, which reads as "fits". That
 *   is not a measurement, it is the absence of one (a `display: none` ancestor,
 *   a detached node), so it is skipped and the previous answer stands.
 * - The measurement is retained when the ref detaches. Callers unmount the
 *   truncated row as soon as it expands, and forgetting the answer there would
 *   retract the very control the user just used.
 * - A webfont that lands after first paint changes the text's width without
 *   resizing the box, so `ResizeObserver` alone never fires. `document.fonts`
 *   is the one signal for it.
 */

import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { RefObject } from 'preact';

/**
 * @param ref Element carrying the truncating class.
 * @param content Deps that change the rendered text; the element's own resize
 *   is observed, but new text in an unchanged box is not.
 */
export function useIsTruncated(
  ref: RefObject<HTMLElement | null>,
  content: unknown,
): boolean {
  const [truncated, setTruncated] = useState(false);
  const measuredRef = useRef(false);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;

    let cancelled = false;
    const measure = () => {
      if (cancelled) return;
      // No layout to measure — keep the last real answer rather than report "fits".
      if (element.clientWidth === 0) return;
      const next = element.scrollWidth > element.clientWidth;
      if (next === measuredRef.current) return;
      measuredRef.current = next;
      setTruncated(next);
    };

    measure();

    // Fonts swap after first paint and move the text inside a box that never
    // resizes, so no observer fires; `fonts.ready` is the only signal. Absent
    // in a DOM without font loading (a test environment), hence the guard.
    document?.fonts?.ready?.then(measure).catch(() => {});

    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);

    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [ref, content]);

  return truncated;
}
