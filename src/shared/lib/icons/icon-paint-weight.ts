/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * `text-ink/60` is a WEIGHT, not a colour choice — and a weight means LESS
 * COLOUR, not a darker colour.
 *
 * Split out of `icon-paint-css.ts` so both files stay readable, not because the
 * rules are independent: they are the family that sheet concatenates, and they
 * are stated AFTER `paintRules` because they transform what it resolves.
 *
 * The settings sidebar, the composer toolbar and a few hundred other call sites
 * write `text-ink/40`-`/80` to mute an icon. That is "the ink, quieter": the
 * caller chose a weight, not a colour. A utility class is (0,1,0) and the hue
 * rules are `:where()` (0,0,0), so the mute won and every muted icon stayed ink
 * in the colour mode ("icon di setting modal kenapa gk full color").
 *
 * ## The bug this replaces
 *
 * The first answer mixed the hue toward `var(--theme-ink)`. That does two things
 * at once — it desaturates AND darkens — and darkening is the opposite of what a
 * mute means. Measured on the settings sidebar (hue 250, `#736aec` on `paper`'s
 * `#faf8f3`): the pure tone reads **3.96:1**, `text-ink/60` monochrome reads
 * **4.74:1**, and the old rule painted **7.48:1** — a muted icon DARKER than the
 * active one beside it, and darker than the monochrome ink it replaced. That is
 * the "icon di modal setting masih kusam di light mode" report: not a shortage of
 * chroma but a colour pushed to a weight it was never meant to have. Over all 36
 * hues and all 32 light palettes the old rule moved mean contrast 4.37 → 9.46 as
 * the weight got quieter, while monochrome moved 9.17 → 1.60.
 *
 * ## The rule now
 *
 * Multiply the CHROMA by the weight and leave LIGHTNESS alone: `60%` of a hue's
 * chroma is the same hue, quieter, at the legibility the tone was solved for.
 * Measured over the same matrix: contrast holds at **3.87 mean / 3.07 min** from
 * `text-ink/90` down to `/25` (the tone's own 3.91), while chroma falls 0.146 →
 * 0.040 — the icon recedes by losing colour rather than by going dark. Dark
 * behaves the same way (3.83 mean, 3.02 min), because the transform never reads
 * the variant.
 *
 * ## Two facts about the SELECTOR, both measured
 *
 * **1. `[class~=…]`, never `[class*=…]`.** A substring match also fires on the
 * VARIANT token: `text-ink/50 group-hover:text-ink/80` matched both `/50` and
 * `/80`, so the resting icon was painted at its HOVER weight — measured in the
 * composer's target picker, `Folder` computed `oklch(… 0.151 320)` (the `/80`
 * paint) while it was not hovered. `~=` compares one whitespace-separated word,
 * and `group-hover:text-ink/80` is not the word `text-ink/80`, so the base
 * weight is the only one that applies at rest.
 *
 * **2. The variants are stated explicitly.** With the base weights matching
 * exactly, `hover:text-ink/70` and `group-hover:text-ink/80` would otherwise be
 * ignored entirely (the paint rule sets `color` on the `svg` itself, so
 * inheritance from the hovered parent cannot reach it). Each variant is
 * re-stated against its own pseudo-class, which also gives it the higher
 * specificity the tie needs.
 *
 * ## And it no longer eats a signal
 *
 * The rule is stated against `--icon-color`, not against a hue formula, so a
 * signal glyph (`--icon-color: var(--theme-warning)`) keeps its token and is
 * merely quieted — measured, `Bell` under `text-ink/60` used to paint
 * `rgb(26,53,80)`, the warning orange replaced by the hashed hue path. Now it
 * paints warning at 60% chroma (`oklch(0.553 0.104 38.4)`).
 *
 * `oklch(from …)` is relative colour syntax: it reads the source in OKLCH and
 * rewrites one channel, which is the only CSS way to say "same colour, less of
 * it". Supported in every engine this app targets (Chromium 119+, Safari 16.4+,
 * WebKitGTK 2.42+); an engine that lacks it IGNORES the declaration and keeps
 * the full-strength paint, so the failure is an unmuted icon, never a missing
 * one.
 */

/** The steps call sites actually use, plus the neighbours a new one may reach for. */
const WEIGHT_STEPS = [20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90];

/** The weight at `step/100`, or the untouched colour. */
function paintAt(step: number | null): string {
  return step === null ? 'var(--icon-color)' : `oklch(from var(--icon-color) l calc(c * ${step / 100}) h)`;
}

/** Every variant prefix that carries a `text-ink` weight somewhere in this app. */
const VARIANTS = ['hover', 'group-hover'] as const;

/**
 * `selector` and the weight it paints. `prefix` is empty for the resting state.
 *
 * DOM order matters: `.group` is an ANCESTOR of the icon while
 * `[data-icon-style]` sits on `<html>`, so the group has to come AFTER the mode
 * gate. Stated the other way round (`group:hover [data-icon-style="color"] …`)
 * the selector demands a descendant carrying the attribute and never matches —
 * measured, `group-hover:text-ink/80` had no effect at all.
 *
 * The order this returns is the order the rules are emitted in, and it matters:
 * a variant has strictly higher specificity than the base, so a hover weight
 * always wins over the resting one, whatever order the two landed in the sheet.
 */
function weightRule(variant: (typeof VARIANTS)[number] | null, step: number | null, dark: boolean): string {
  const mode = dark ? '[data-icon-style="color"][data-theme-variant="dark"]' : '[data-icon-style="color"]';
  const token = variant ? `${variant}:text-ink` : 'text-ink';
  const suffix = step === null ? '' : `/${step}`;
  // `.group:hover` for the shared-parent variant, `svg:hover` for the direct one.
  const scope = variant === 'group-hover' ? '.group:hover ' : '';
  const pseudo = variant === 'hover' ? ':hover' : '';
  return `${mode} ${scope}svg.lucide:not(.project-accent-mark)[class~="${token}${suffix}"]${pseudo} { --icon-paint: ${paintAt(step)}; }`;
}

export function inkWeightRules(): string[] {
  const rules: string[] = [];
  for (const dark of [false, true]) {
    // The un-suffixed `text-ink` is the full-strength ink, and its variants are
    // "the caller wants full ink back" — the same paint, no step.
    rules.push(weightRule(null, null, dark));
    for (const variant of VARIANTS) rules.push(weightRule(variant, null, dark));
    for (const step of WEIGHT_STEPS) rules.push(weightRule(null, step, dark));
    for (const step of WEIGHT_STEPS) {
      for (const variant of VARIANTS) rules.push(weightRule(variant, step, dark));
    }
  }
  return rules;
}
