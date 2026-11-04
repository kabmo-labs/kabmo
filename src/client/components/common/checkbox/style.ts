/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The checkbox, drawn by us instead of by the engine.
 *
 * A native `<input type="checkbox">` with `accent-color` is the right CONTROL —
 * it carries checked/indeterminate, keyboard behaviour and the announcement for
 * free — but its rendering is the platform's, and the platform disagrees with
 * this app about what "on" and "off" look like:
 *
 * - **The unchecked box is nearly invisible.** Measured in the session sidebar
 *   (batch selection), the unchecked box composited to `(236,238,235)` on a
 *   `(250,248,242)` row — **1.10:1** — while the checked one was 10.84:1. Two
 *   states 10 points apart in luminance are not a control you can read; the
 *   report was "checkbox gk kelihatan on off nya".
 * - **The checked box is the platform's accent**, not the palette's: Chromium
 *   paints `accent-color` as a FILL and then whichever glyph it likes, so the
 *   tint tracks `--theme-ink` here but the tick colour, the corner radius and the
 *   size are the engine's.
 * - **The indeterminate dash** is a property with no attribute equivalent, so a
 *   styled span could not carry it anyway.
 *
 * So the input STAYS (same semantics, same `indeterminate` assignment) and only
 * its box is replaced: `appearance: none` plus a pseudo-element that states each
 * state explicitly, in palette tokens.
 *
 * **The numbers are a contrast budget, not taste.** The unchecked ring needs 3:1
 * against the surface it sits on — WCAG's non-text floor, the same one the brand
 * marks use — and a `text-ink/NN` alpha is the only way to reach it on every
 * palette: measured across all 43, `ink 75%` is the first alpha whose worst case
 * clears the floor (3.02:1 on `solarized-light`); 60% is 2.34:1 and 40% — the
 * `border-ink/30` these controls shipped with — is **1.71:1**. The checked fill
 * is the full ink, which makes the tick `paper`, so the pair is the palette's
 * own `ink`/`paper` contrast: 4.85:1 worst case, 17.5:1 on `paper`.
 *
 * `accent-color` is left set as well: a browser that cannot draw the
 * pseudo-element still gets the platform control rather than a blank square.
 */

/**
 * `appearance: none` plus a state pseudo-element, in ONE class so 22 call sites
 * cannot drift into 22 slightly different boxes.
 *
 * The rules live in `tailwind.css` (`.kabmo-checkbox`) rather than here because
 * they are CSS-only facts about a state selector — `checked`, `indeterminate`,
 * `disabled` — that no component can express.
 */
export const CHECKBOX_CLASS = 'kabmo-checkbox';
