/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The two surfaces where the call site OUTRANKS the colour mode.
 *
 * Split out of `icon-paint-css.ts` so both files stay readable, not because the
 * rules are independent: they are one of the families that sheet concatenates.
 *
 * The mode's contract is "paint an icon that said nothing". Both rules here take
 * an icon that DID say something and give it the value it asked for — one by
 * name (`text-error`), one by the surface it sits on (a solid signal fill). They
 * are the only rules in the sheet whose job is to STOP the generated hue.
 */

/**
 * The weights an author's signal class actually uses (`text-error/60`,
 * `text-success/90`, …). Measured over `src/client/**`: 29 slashed call sites,
 * every one of them in this set. A step not listed here falls back to the hue,
 * which is the old behaviour for a class this build has never seen.
 */
const AUTHOR_COLOUR_STEPS = [60, 70, 80, 90] as const;

/** The signal classes a call site may write, and the token each one means. */
const AUTHOR_COLOURS: ReadonlyArray<readonly [string, string]> = [
  ['text-error', 'var(--theme-error)'],
  ['text-success', 'var(--theme-success)'],
  ['text-warning', 'var(--theme-warning)'],
  ['text-info', 'var(--theme-info)'],
  ['text-meta', 'var(--theme-meta)'],
];

/**
 * An AUTHOR's colour on a glyph is a decision, not a default to overwrite.
 *
 * The mode paints by hue, and a hue is only ever the answer to "this icon said
 * nothing". Twenty-two call sites say something: a `LogOut` on a destructive
 * provider action is `text-error`, a `Play` on a successful eval is
 * `text-success`, an `Info` about a reconnect is `text-info`. Every one of them
 * was silently repainted with its hashed hue the moment the setting was turned
 * on, so the mode DISCARDED the only colour information the call site had.
 *
 * `--icon-color`, not `color`: the value then flows through the same paint and
 * weight rules as every other source, so a slashed mute and the hover variants
 * keep working instead of being frozen at full strength.
 *
 * `[class~=…]`, never `[class*=…]`: a substring match also fires on the VARIANT
 * token, so `group-hover:text-error` would paint the resting icon red — the
 * defect `icon-paint-weight.ts` documents for the ink weights.
 */
export function authorColourRules(): string[] {
  const rules: string[] = [];
  for (const [token, value] of AUTHOR_COLOURS) {
    rules.push(`:where([data-icon-style="color"]) :where(svg[class~="${token}"]) { --icon-color: ${value}; }`);
    // The SLASHED form is the same statement at a weight, so it has to resolve
    // `--icon-color` too, or the icon falls back to the hue while the class says
    // otherwise. The formula is the one `inkWeightRules` uses: scale chroma,
    // never lightness.
    for (const step of AUTHOR_COLOUR_STEPS) {
      rules.push(
        `:where([data-icon-style="color"]) :where(svg[class~="${token}/${step}"]) { --icon-color: oklch(from ${value} l calc(c * ${step / 100}) h); }`,
      );
    }
  }
  return rules;
}

/**
 * The class tokens that mean "this element IS a solid signal fill".
 *
 * Both spellings count. `bg-error` is the palette's own hex, and `bg-error-text`
 * is the SAME hue solved to 4.5:1 against paper and canvas — the one a filled
 * control uses, because the raw hex is chosen for a chip's ground and measures
 * 2.73:1 on `mono-light`. A rule that knew only `bg-error` left the composer's
 * Stop and Send glyphs on the icon mode's own hue.
 */
const SOLID_FILL_TOKENS = [
  'bg-error',
  'bg-error-text',
  'bg-success',
  'bg-success-text',
  'bg-warning',
  'bg-warning-text',
  'bg-info',
  'bg-info-text',
] as const;

/** `[class~="bg-error"], …` — the SOLID classes only, never a `/10` tint. */
const SOLID_FILL_SCOPE = SOLID_FILL_TOKENS.map((token) => `[class~="${token}"]`).join(', ');

/**
 * Inside a SOLID signal fill, the glyph takes the surface's own foreground.
 *
 * `bg-error text-canvas` is a filled destructive button — Delete, Close, the
 * mobile save-and-recreate, the composer's Stop and Send — and the colour mode
 * painted the glyph in the same red as the fill it sits on: measured in the
 * running console, `Trash2` on the Delete button computed `rgb(200, 50, 30)` on
 * `rgb(200, 50, 30)`, **1.00:1**, a white space where a bin should be. A hue is
 * tuned for paper; a signal fill is the signal used as paper, so the surface's
 * declared foreground is the only value that is right on it — exactly the
 * argument `invertedSurfaceRules` makes for `bg-ink`.
 *
 * `[class~="bg-error"]` matches the SOLID class only: Tailwind spells a tinted
 * one `bg-error/10`, a different token, so a tinted chip keeps its hue. Stated
 * after `paintRules` at the same (0,2,1) so it wins on order.
 */
export function solidSignalFillRules(): string[] {
  return [
    `[data-icon-style="color"] :where(${SOLID_FILL_SCOPE}) svg.lucide { color: currentColor; }`,
    `:where([data-icon-style="color"]) :where(${SOLID_FILL_SCOPE}) :where([data-plugin-mark]) { --plugin-color: currentColor; }`,
  ];
}

/**
 * The same fill, in MONOCHROME — and there it was a blank button.
 *
 * The rule above is gated on the colour mode, but `monochrome` is the DEFAULT
 * (`DEFAULT_ICON_STYLE`), and its rule paints every glyph without a `text-ink`
 * class in `var(--theme-ink)`. On a solid signal fill that ink is the fill:
 * measured across the 63 palettes, `Square` on `bg-error` computes **1.04:1**
 * on `osaka-jade-light` and 44 of 63 sit under the 3:1 graphic floor. So the
 * fill has to be excluded from the ink pass and take the surface's foreground
 * in this mode too.
 *
 * The exclusions live on the monochrome rule itself (below) rather than here,
 * because that rule is (0,5,1) and anything stated after it would need to
 * out-specify a selector that exists to beat single utilities.
 */
export function monochromeSolidFillRules(): string[] {
  return [
    `:root:not([data-icon-style="color"]) :where(${SOLID_FILL_SCOPE}) svg.lucide { color: currentColor; }`,
    `:root:not([data-icon-style="color"]) :where(${SOLID_FILL_SCOPE}) :where([data-plugin-mark]) { --plugin-color: currentColor; }`,
  ];
}

/** The monochrome ink pass must not reach a solid fill (see above). */
export const SOLID_FILL_EXCLUSIONS = SOLID_FILL_TOKENS.map((token) => `:not([class~="${token}"] *)`).join('');
