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
 */

import { useEffect, useState } from 'preact/hooks';
import type { RefObject } from 'preact';

/** The nearest ancestor that actually scrolls, or null for the document. */
function scrollParent(element: HTMLElement): HTMLElement | null {
  let node = element.parentElement;
  while (node) {
    const style = getComputedStyle(node);
    if (/(auto|scroll|overlay)/.test(style.overflowY) && node.scrollHeight > node.clientHeight) return node;
    node = node.parentElement;
  }
  return null;
}

/**
 * True while `ref`'s element is pinned against the top of its scroll container.
 *
 * Re-measured on the container's `scroll`, on resize, and once after mount
 * (layout settles a frame later). A rAF coalesces the scroll events, so a fast
 * scroll costs one measurement per frame rather than one per event.
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
    (container ?? window).addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      pending = false;
      (container ?? window).removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
    };
  }, [ref]);

  return stuck;
}
