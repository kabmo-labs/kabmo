/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The two modes that paint a glyph in INK rather than a hue.
 *
 * Split out of `icon-paint-css.ts` so both files stay readable, not because the
 * rules are independent: they are one of the families that sheet concatenates.
 *
 * Monochrome is the absence of `data-icon-style`, and a tool card is ink in BOTH
 * modes — so these are the only rules in the sheet that can override a caller's
 * colour class by design rather than by cascade accident.
 */

import { SOLID_FILL_EXCLUSIONS } from '@/shared/lib/icons/icon-paint-authority';

/**
 * MONOCHROME: an icon takes the ink of the text beside it.
 *
 * The colour mode is a generated sheet of hues; monochrome is the ABSENCE of the
 * attribute, and until this rule that absence only meant "no hue is added" — it
 * did not take away the colours an AUTHOR had written. So a `Check` with
 * `text-success` in a tool card stayed green with the setting on monochrome
 * ("di setting monochrome kenapa iconnya berwarna?"), and the same icon then
 * turned into a hue under `color`, which read as the mode being half-applied.
 *
 * `var(--theme-ink)`, not `currentColor`: a `Check` inside a green status chip
 * INHERITS the chip's green, so `currentColor` left it green — measured, two
 * icons survived a monochrome pass that way (`lucide-info` in an info chip, a
 * loader in a warning one). Icons that say `text-ink/…` are excluded (that IS
 * the ink, at the weight the caller chose), and an inverted `bg-ink` surface
 * keeps its own foreground.
 *
 * A SOLID SIGNAL FILL is excluded for the same reason as `bg-ink`: the ink is
 * the wrong end of the contrast on it. Measured over the 63 palettes, a glyph
 * on `bg-error` computed 1.04:1 on `osaka-jade-light`, and 44 of 63 sat under
 * the 3:1 floor for a graphic — the composer's newly filled Stop and Send
 * buttons would have been blank squares on any monochrome install. The
 * foreground comes from `monochromeSolidFillRules`, stated after this one.
 *
 * Specificity is the point: `:root:not(…)` plus the class beats a single utility
 * class, so this wins over `text-success` inside the same layer.
 */
export function monochromeRules(): string[] {
  return [
    `:root:not([data-icon-style="color"]) svg.lucide:not([class*="text-ink"]):not(.bg-ink *)${SOLID_FILL_EXCLUSIONS} { color: var(--theme-ink); }`,
    ':root:not([data-icon-style="color"]) [data-plugin-mark] { --plugin-color: currentColor; }',
  ];
}

/**
 * Inside a TOOL CARD, icons are ink in BOTH modes.
 *
 * A transcript is a reading surface: one turn can hold twenty cards, each with a
 * status chip, a file mark and a chevron, and a hue per icon turns the densest
 * part of the app into confetti. The codebase already said so for file-type
 * marks — `languageBrandIcon` passes `monochrome` for exactly this surface — but
 * the Lucide glyphs inside a card were never covered, so they followed the mode
 * and flipped colour the moment the setting changed.
 *
 * `var(--theme-ink)` rather than `currentColor`: the check inside a green status
 * chip inherits the chip's green, which is the colour this rule exists to remove.
 * Icons that declare `text-ink/…` are left alone (that is the ink, at the weight
 * the caller chose), and an inverted `bg-ink` surface or a solid signal fill
 * keeps its own foreground — that surface declares it, and this rule is about
 * the glyphs that declare nothing.
 */
export function toolCardRules(): string[] {
  return [
    `[data-tool-row] svg.lucide:not([class*="text-ink"]):not(.bg-ink *)${SOLID_FILL_EXCLUSIONS} { color: var(--theme-ink); }`,
    '[data-tool-row] [data-plugin-mark] { --plugin-color: var(--theme-ink); }',
  ];
}

/**
 * A small glyph is drawn with a slightly heavier stroke, because at 12-14px a 2px
 * stroke is barely one pixel of ink once rasterised.
 *
 * This is the answer to "ikon kecil kurang tegas" that costs NOTHING in contrast:
 * the colour already solves to the brightest legal lightness the paper allows
 * (mean L 0.626 on the light side, 3.15:1 minimum), and a light-mode glyph cannot
 * be made brighter than that without dropping under the graphic floor — measured,
 * L 0.78 on `#f1f1f0` is 1.96:1, which is invisible. Thickening the stroke raises
 * how much ink the glyph actually puts down instead.
 *
 * **Measured constraint: the attribute cannot opt out.** Lucide writes
 * `stroke-width="2"` for a default AND `stroke-width="1.8"` for an explicit prop,
 * so `:not([stroke-width])` never matches anything and a rule keyed on it is
 * dead. This rule therefore wins over both, which is acceptable because the four
 * bundled explicit weights (1.6, 1.8, 2.2, 2.4) are all within a quarter-pixel of
 * this value — the dense outline lists that ask for 1.8 asked for a LIGHTER
 * stroke than 2.4, and 2.25 keeps that intent within one step while making the
 * 12px glyph legible. CSS outranks a presentation attribute, which is what makes
 * this a stylesheet rule instead of 400 call-site edits.
 *
 * The selector is deliberately narrow: `svg.lucide` is on the element, so the
 * rule only reaches an ICON, and the sizes are listed because SVG has no numeric
 * attribute selector.
 */
const SMALL_GLYPH_STROKE = '2.25';

export function smallGlyphStrokeRules(): string[] {
  return [
    `svg.lucide:is([width="10"], [width="11"], [width="12"], [width="13"], [width="14"]) { stroke-width: ${SMALL_GLYPH_STROKE}; }`,
  ];
}
