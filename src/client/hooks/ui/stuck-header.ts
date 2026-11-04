/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Whether a `position: sticky` element is currently PINNED.
 *
 * A sticky header needs a surface only while it is overlapping content — that is
 * the moment its text sits on top of a row and needs a field of its own. When it
 * is at rest it is just the first line of the list, and painting it there is what
 * draws a band across a surface that is otherwise uniform.
 *
 * The test is geometric and needs no sentinel: a stuck element's own top edge is
 * at (or above) its scroll container's content top, because that is what sticky
 * positioning does. A sentinel would have to be a second element in the DOM, and
 * every caller would have to place it in the same flow — one more thing that can
 * be forgotten.
 *
 * `root: null`-style viewport maths is deliberately NOT used: the sidebar is an
 * inner scroll container, so the comparison has to be against THAT box.
 *
 * ## The scrollport is found by `overflow-y`, never by "does it overflow"
 *
 * From a sentinel-free test it is tempting to require `scrollHeight > clientHeight`
 * when picking the container — "the nearest ancestor that actually scrolls".
 * That test reads ZERO for a subtree mounted hidden, and the phone drawer IS
 * mounted hidden: its screen is a sibling carrying `hidden`, so at mount the
 * scroller measures 0/0. The hook then fell through to `window` (`scrollY`),
 * which never moves for an inner scroller — measured on a 412x900 viewport with
 * the drawer open and 420px scrolled, the folder header sat pinned at the
 * container's top edge with **no** `data-stuck`, i.e. an active sticky header
 * with a transparent background, while the desktop column (mounted visible)
 * painted its fill. Per spec a `position: sticky` element is bound to its
 * nearest SCROLL CONTAINER whether or not it overflows at this instant, so the
 * `overflow-y` test alone is the accurate one — and it answers correctly for a
 * hidden subtree, because computed style does not depend on the ancestor's
 * `display`.
 *
 * Showing the drawer then has to re-measure by itself: a hidden subtree resizes
 * from 0x0, so a `ResizeObserver` on the header (and on the container) is the
 * signal that layout became real.
 */

import { useEffect, useState } from 'preact/hooks';
import type { RefObject } from 'preact';

/** The nearest ancestor that scrolls (the sticky containing block), or null. */
function scrollParent(element: HTMLElement): HTMLElement | null {
  let node = element.parentElement;
  while (node) {
    const style = getComputedStyle(node);
    if (/(auto|scroll|overlay)/.test(style.overflowY)) return node;
    node = node.parentElement;
  }
  return null;
}

/**
 * True while `ref`'s element is pinned against the top of its scroll container.
 *
 * Re-measured on the container's `scroll`, on resize, whenever the header or its
 * container changes SIZE, and once after mount (layout settles a frame later). A
 * rAF coalesces the scroll events, so a fast scroll costs one measurement per
 * frame rather than one per event.
 */
export function useStuckHeader(ref: RefObject<HTMLElement | null>): boolean {
  const [stuck, setStuck] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const container = scrollParent(element);
    // A boolean rather than the frame handle: the handle is assigned AFTER the
    // callback runs, so a synchronous `requestAnimationFrame` (a test seam, a
    // polyfill) would leave it set and block every later measurement.
    let pending = false;

    const measure = () => {
      pending = false;
      const box = container ? container.getBoundingClientRect() : { top: 0 };
      // The scroll offset is part of the test, not a detail: an element that
      // starts at the container's top edge satisfies the geometric comparison at
      // `scrollTop: 0` too, so without this the header would paint its stuck
      // surface BEFORE anything scrolled under it — the band, restored by the
      // very fix meant to remove it. "Stuck" means overlapping, and nothing is
      // overlapping at offset zero.
      const scrolled = container ? container.scrollTop > 0 : window.scrollY > 0;
      // 0.5px of slack: sub-pixel scroll offsets otherwise flip the state on
      // every frame while the user scrolls slowly. The lower bound matters too:
      // a header whose section has scrolled past sits entirely above the
      // container, and painting it would be work nobody can see.
      const rect = element.getBoundingClientRect();
      setStuck(scrolled && rect.top <= box.top + 0.5 && rect.bottom > box.top);
    };
    const schedule = () => {
      if (pending) return;
      pending = true;
      requestAnimationFrame(measure);
    };

    measure();
    // A hidden subtree mounts at 0x0 and its sticky geometry only becomes real
    // when the ancestor stops being `hidden` — which is the phone drawer's whole
    // lifecycle (`SessionSidebar` keeps the list mounted behind a hidden
    // screen). Both boxes are watched: the container for the drawer appearing,
    // the header for a density or label-height change.
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
    resize?.observe(element);
    if (container) resize?.observe(container);
    (container ?? window).addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      pending = false;
      resize?.disconnect();
      (container ?? window).removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
    };
  }, [ref]);

  return stuck;
}
