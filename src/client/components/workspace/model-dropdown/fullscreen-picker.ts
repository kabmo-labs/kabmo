/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Whether the model picker takes the whole screen or hangs beside its trigger.
 *
 * **A phone gets the whole screen.** The composer sits at the bottom of a 390px
 * screen, so an upward popover gets the short half of the viewport, its width is
 * decided by the trigger, and the on-screen keyboard removes most of what is
 * left. A fixed overlay takes the full height, keeps the search field reachable
 * with the keyboard up, and is what every other picker on the platform does.
 *
 * **A desktop keeps the popover**, anchored above the trigger: there is space
 * for it, the list is meant to be scanned next to the composer it belongs to,
 * and covering a 1440x900 workspace to pick a model would be a step backwards.
 *
 * The decision is the POINTER, not a pixel breakpoint: a 900px-wide window
 * driven by touch is still a phone surface, and a 600px-wide desktop window with
 * a mouse is still a desktop. Width is the fallback for a browser that does not
 * answer `(pointer: coarse)`.
 *
 * `isMobile` — the SHELL's own verdict — wins when it is passed. The shell
 * already decided the layout from the user agent + pointer + a landscape-phone
 * height test (`App.tsx`), and a picker that disagreed with the shell it is
 * painted inside would be a second, subtly different answer to one question.
 */

import { useEffect, useState } from 'preact/hooks';

/** True when the picker should take the screen instead of hanging beside the trigger. */
export function useFullscreenPicker(isMobile?: boolean): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const coarse = window.matchMedia('(pointer: coarse)');
    const narrow = window.matchMedia('(max-width: 640px)');
    const sync = () => setMatches(coarse.matches || narrow.matches);
    sync();
    coarse.addEventListener('change', sync);
    narrow.addEventListener('change', sync);
    return () => {
      coarse.removeEventListener('change', sync);
      narrow.removeEventListener('change', sync);
    };
  }, []);

  return isMobile ?? matches;
}
