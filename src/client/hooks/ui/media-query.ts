/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Whether the viewport is at least `px` wide, subscribed.
 *
 * The phone header decides from this whether its controls fit in the row or
 * have to fold into a `⋯` menu, and that decision cannot be a CSS breakpoint:
 * the row's contents are COMPONENTS (a reload button, a sign-out control that
 * only exists when a password is set, plugin header slots), and a class that
 * hides one of them leaves it mounted and focusable while invisible. A hook
 * returns a boolean the caller branches on, so a folded control is not
 * rendered at all.
 *
 * Subscribed rather than read once, for the reason `useTouchDevice` is: a phone
 * rotates, a desktop window is dragged, and a split-screen tablet changes width
 * without a reload.
 */

import { useEffect, useState } from 'preact/hooks';

/**
 * The window's current width, subscribed.
 *
 * `useViewportAtLeast` answers a yes/no question, which is all a control that
 * folds or not needs. The desktop sidebar asks a different one — how many
 * pixels the window has, so its own width can be capped as a SHARE of them
 * (`sidebarWidthForViewport`) — and a boolean cannot answer that.
 */
export function useViewportWidth(): number {
  const [width, setWidth] = useState(() => (typeof window === 'undefined' ? 0 : window.innerWidth));

  useEffect(() => {
    const update = () => setWidth(window.innerWidth);
    // Read once on the way in: a window resized between the first render and
    // this effect would otherwise keep the stale value until the next resize.
    update();
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
    };
  }, []);

  return width;
}

export function useViewportAtLeast(px: number): boolean {
  const query = `(min-width: ${px}px)`;
  const [matches, setMatches] = useState(() =>
    typeof window === 'undefined' ? false : window.matchMedia(query).matches,
  );

  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    // The query can change while the effect is not subscribed — a render that
    // happened before the media query existed — so read it once on the way in.
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, [query]);

  return matches;
}
