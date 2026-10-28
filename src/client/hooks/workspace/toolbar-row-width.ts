/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The toolbar row's CONTENT width, kept current as its container is resized.
 *
 * Both session-sidebar toolbars decide their visible set from measured width
 * rather than a media query — the desktop sidebar is dragged, and the phone's
 * drawer is whatever the device gives it — so both need the same measurement.
 * A `@container` breakpoint cannot answer this: it would keep hiding controls
 * after the user widened the panel.
 *
 * The width is a LAYOUT effect, so the first measure lands BEFORE paint: with a
 * passive effect the row drew every control and then dropped the ones that did
 * not fit on the next frame.
 */

import { useLayoutEffect, useRef, useState } from 'preact/hooks';

/**
 * @param paddingPx Padding the row's `clientWidth` includes but the capacity
 *   budget must not (the desktop row's own `px-1`). Pass `0` for a row that is
 *   padded by its container instead, which is what the phone's drawer does.
 */
export function useToolbarRowWidth(paddingPx: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => setWidth(Math.max(0, element.clientWidth - paddingPx));
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [paddingPx]);

  return { ref, width };
}
