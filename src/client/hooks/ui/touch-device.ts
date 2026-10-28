/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Whether this device is typed into with a soft keyboard — the only condition
 * under which a terminal needs on-screen keys.
 *
 * `(pointer: coarse)` is the signal: a phone or tablet reports it, and a
 * touchscreen laptop does not, because its primary pointer is the trackpad.
 * The fallback covers the devices that report a fine pointer anyway (some
 * Android desktop modes): touch points plus `(hover: none)`, which is the pair
 * that means "there is no pointer at all" rather than "there is a screen that
 * can be touched".
 *
 * The queries are subscribed, not read once: a hybrid device that docks a
 * keyboard or leaves tablet mode changes the answer, and a bar of keys that
 * cannot react to that is stuck on a desktop or missing on a phone.
 */

import { useEffect, useState } from 'preact/hooks';

const COARSE_POINTER_QUERY = '(pointer: coarse)';
const NO_HOVER_QUERY = '(hover: none)';

function detectSoftKeyboardDevice(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.matchMedia(COARSE_POINTER_QUERY).matches) return true;
  return navigator.maxTouchPoints > 0 && window.matchMedia(NO_HOVER_QUERY).matches;
}

export function useTouchDevice(): boolean {
  const [isTouch, setIsTouch] = useState(detectSoftKeyboardDevice);

  useEffect(() => {
    const queries = [COARSE_POINTER_QUERY, NO_HOVER_QUERY].map((q) => window.matchMedia(q));
    const update = () => setIsTouch(detectSoftKeyboardDevice());
    for (const query of queries) query.addEventListener('change', update);
    return () => {
      for (const query of queries) query.removeEventListener('change', update);
    };
  }, []);

  return isTouch;
}
