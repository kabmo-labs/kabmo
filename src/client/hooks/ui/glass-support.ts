/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The live answers to "can this engine draw the glass material", subscribed.
 *
 * `glassLimits` states the rule; this hook is the only place that ASKS the
 * platform, so the settings control never touches `window` itself.
 *
 * Three facts about the asking:
 *
 * - **Both spellings are tested.** Chromium shipped `backdrop-filter`
 *   unprefixed only in 76, and the Android shell's floor is `minSdk 24`; the
 *   stylesheets always write the `-webkit-` pair, so the probe tests the pair
 *   too. Testing one and not the other reports "unsupported" on a device that
 *   renders the frost correctly.
 * - **Computed ONCE.** `CSS.supports` is a parse check on a constant string; it
 *   cannot change while the document lives, and calling it per render would be a
 *   style recalc for a constant.
 * - **`matchMedia` is SUBSCRIBED.** The OS setting can be toggled while the
 *   window is open (System Settings → Accessibility, next to the app), and the
 *   media query then flips without a reload — a stale `false` would leave the
 *   notice hidden on a window that had just gone opaque.
 */

import { useEffect, useState } from 'preact/hooks';
import { glassLimits, type GlassLimit } from '@/shared/lib/theme/glass-support';

const REDUCED_TRANSPARENCY = '(prefers-reduced-transparency: reduce)';

function supportsBackdropFilter(): boolean {
  if (typeof CSS === 'undefined' || typeof CSS.supports !== 'function') return false;
  return (
    CSS.supports('backdrop-filter', 'blur(1px)') ||
    CSS.supports('-webkit-backdrop-filter', 'blur(1px)')
  );
}

export function useGlassLimits(): GlassLimit[] {
  const [reduced, setReduced] = useState(() =>
    typeof window === 'undefined' ? false : window.matchMedia(REDUCED_TRANSPARENCY).matches,
  );

  useEffect(() => {
    const media = window.matchMedia(REDUCED_TRANSPARENCY);
    const update = () => setReduced(media.matches);
    // The query can change between the initial render and this effect, so read it
    // once on the way in — the same reason `useViewportAtLeast` does.
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  return glassLimits({ backdropFilter: supportsBackdropFilter(), reducedTransparency: reduced });
}
