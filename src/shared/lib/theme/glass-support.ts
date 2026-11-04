/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Whether the machine running this document can actually draw the glass
 * material, and if not, WHY.
 *
 * The `glass` surface style is pure CSS: one `backdrop-filter` on the window
 * plane plus the tiers above it. Every shell Kabmo ships renders the same page —
 * Android's `WebView`, iOS/macOS `WKWebView`, Windows' WebView2 and Linux's
 * WebKitGTK 4.1 — so the style is not per-platform. What IS per-platform is the
 * two ways it silently stops working:
 *
 *  - **The engine has no `backdrop-filter`.** Then `glass.css`'s `@supports not
 *    (…)` block hands back the opaque palette, and the window looks exactly like
 *    `classic` while the setting says `glass`. The prefix matters here: Chromium
 *    only shipped the UNPREFIXED property in 76, so an Android 7 device
 *    (`minSdk 24`) whose WebView was never updated still needs
 *    `-webkit-backdrop-filter`, which the stylesheets always write.
 *  - **The system asked apps to reduce transparency.** macOS/iOS "Reduce
 *    Transparency", GNOME's equivalent: the `prefers-reduced-transparency` media
 *    query fires and every translucent token resolves to opaque paper. That is
 *    the intended behaviour — a frosted window is exactly what the setting exists
 *    to remove — but a user who switched the surface style ON and sees no change
 *    reads it as a bug ("glass doesn't work on my mac").
 *
 * Both are REPORTED rather than papered over (`AGENTS.md` §6: a substitution has
 * to name itself), which is the whole reason this module exists: the fallback in
 * CSS cannot say anything, so the settings control says it once, in the place the
 * choice is made.
 *
 * This module is pure — the caller passes what the platform's own APIs answered —
 * so the rule is testable without a browser, and the same answers can be checked
 * from a terminal (`CSS.supports`, `matchMedia`) when a shell misbehaves.
 */

export type GlassLimit = 'no-backdrop-filter' | 'reduced-transparency';

/** What the platform APIs answered. Both are cheap and synchronous. */
export interface GlassProbe {
  /** `CSS.supports('backdrop-filter', …) || CSS.supports('-webkit-backdrop-filter', …)`. */
  backdropFilter: boolean;
  /** `matchMedia('(prefers-reduced-transparency: reduce)').matches`. */
  reducedTransparency: boolean;
}

/**
 * Every reason the frost will not appear, in the order they matter.
 *
 * An engine that cannot blur is the FIRST reason even when the system also asked
 * for less transparency: with no `backdrop-filter` the media query has nothing to
 * switch off, and naming the preference first would send the reader to an OS
 * setting that changes nothing.
 */
export function glassLimits({ backdropFilter, reducedTransparency }: GlassProbe): GlassLimit[] {
  const limits: GlassLimit[] = [];
  if (!backdropFilter) limits.push('no-backdrop-filter');
  if (reducedTransparency) limits.push('reduced-transparency');
  return limits;
}

/**
 * What the settings control says. `null` for a limit is not allowed — a limit
 * with no sentence is a warning nobody can act on.
 */
export const GLASS_LIMIT_COPY: Record<GlassLimit, string> = {
  'no-backdrop-filter':
    'This engine reports no backdrop blur, so the frost falls back to opaque panels here — the window keeps the glass colours but loses the blur.',
  'reduced-transparency':
    'Your system asks apps to reduce transparency, so the frost is switched off. Turn that system setting off to see the glass material.',
};
