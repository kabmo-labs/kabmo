/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Every `[data-icon-style="color"]` rule, as one generated string.
 *
 * Three families of icon live in this app and they need three different paints,
 * but they share ONE contract: **a paint rule is a DEFAULT, never an override.**
 * Two mechanisms together buy that, and BOTH are needed:
 *
 * - **`:where()` on every selector**, so the whole sheet has zero specificity.
 * - **`@layer utilities` around it**, so it sits in Tailwind's own utilities
 *   layer. A cascade layer beats specificity: an UNLAYERED rule wins over every
 *   layered one, so without this wrapper a zero-specificity rule still beat
 *   `text-ink/75` — measured in the running console, a muted folder icon painted
 *   its generated purple instead of the muted ink. Inside the layer, the
 *   caller's class (specificity 0,1,0) outranks ours (0) and wins.
 *
 * The sheet therefore declares Tailwind's FULL layer order before its own block.
 * That is not decoration: this `<style>` is inlined into the shell's `<head>`,
 * which the browser parses BEFORE the bundled stylesheet, and a first `@layer
 * utilities { … }` block would freeze `utilities` as the LOWEST layer — every
 * later `theme, base, components` block would then outrank every utility, and
 * the whole app would lose its spacing and borders. Measured: with the bare
 * block, the sidebar and composer collapsed to a 0-width column.
 *
 * That is what makes a global colour mode safe over 346 files that never agreed
 * to it: the app's deliberate colours are untouched, and the icons that said
 * nothing get one.
 *
 * 1. **Functional glyphs** (`lucide-*`) get their own hue, or a palette signal
 *    when the glyph means something (`icons/tint.ts`). Two statements, not 210:
 *    the hue is a custom property on the class, and ONE paint rule reads it.
 * 2. **Provider marks** (`data-provider`) take their brand's colour.
 * 3. **File-type marks** (`data-file-brand`) take theirs.
 *
 * The two brand families also emit a dark rule, because their light value is a
 * darkened brand hex and would be illegible on a dark palette; the
 * near-monochrome rows pin `var(--theme-ink)` explicitly, so the mark cannot
 * inherit a colour from a hover state.
 *
 * No DOM here — the SSR shell inlines this, and the client injects the same
 * string only when a served document predates it.
 */

import { BRAND_COLORS } from '@/shared/lib/models/provider/brand-color';
import { panelMarkRules } from '@/shared/lib/icons/icon-paint-panel';
import { FILE_BRAND_COLORS } from '@/shared/lib/icons/file-brand-color';
import {
  DEFAULT_ICON_HUE,
  ICON_HUE_ROWS,
  ICON_TINT_ROWS,
  ICON_TINT_TOKENS,
  iconHuePaint,
} from '@/shared/lib/icons/tint';

/** The `<style>` element's id: the SSR shell writes it, the client checks it. */
export const ICON_PAINT_STYLE_ELEMENT_ID = 'omp-icon-paint';

/** Both rules for one brand, since a brand colour has two values. */
function brandRules(selector: string, light: string, dark: string | null): string[] {
  return [
    `:where([data-icon-style="color"]) :where(${selector}) { color: ${light}; }`,
    `:where([data-icon-style="color"][data-theme-variant="dark"]) :where(${selector}) { color: ${dark ?? 'var(--theme-ink)'}; }`,
  ];
}

/** The hue a functional glyph is painted with, per variant. */
function hueRules(): string[] {
  const rules = [
    `:where([data-icon-style="color"]) :where(svg.lucide) { color: ${iconHuePaint('light')}; }`,
    `:where([data-icon-style="color"][data-theme-variant="dark"]) :where(svg.lucide) { color: ${iconHuePaint('dark')}; }`,
  ];
  for (const { className, hue } of ICON_HUE_ROWS) {
    rules.push(`:where([data-icon-style="color"]) :where(svg.${className}) { --icon-hue: ${hue}; }`);
  }
  return rules;
}

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
 * Specificity is the point: `:root:not(…)` plus the class beats a single utility
 * class, so this wins over `text-success` inside the same layer.
 */
function monochromeRules(): string[] {
  return [
    ':root:not([data-icon-style="color"]) svg.lucide:not([class*="text-ink"]):not(.bg-ink *) { color: var(--theme-ink); }',
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
 * the caller chose), and an inverted `bg-ink` surface keeps its own foreground.
 */
function toolCardRules(): string[] {
  return [
    '[data-tool-row] svg.lucide:not([class*="text-ink"]):not(.bg-ink *) { color: var(--theme-ink); }',
    '[data-tool-row] [data-plugin-mark] { --plugin-color: var(--theme-ink); }',
  ];
}

/**
 * The project accent a folder's mark is drawn in — the one colour a user picked
 * themselves (Project settings → accent).
 *
 * It is a property rather than an inline `color`, because an inline style cannot
 * be answered by the mode: the accent belongs to the COLOUR mode, and under
 * monochrome the mark is the palette ink like every other icon.
 *
 * The accent is applied at FULL strength even though the call sites also write
 * `text-ink/70` — the weight is how a call site mutes the palette ink, and the
 * user's chosen colour is not the ink being muted.
 *
 * That is why `inkWeightRules` EXCLUDES this class rather than the accent trying
 * to out-specify it. It cannot: the dark weight selector is
 * `[data-icon-style="color"][data-theme-variant="dark"] svg.lucide[class*="text-ink/70"]`
 * = (0,4,1), one element above `:root[data-icon-style="color"] .project-accent-mark`
 * = (0,4,0) — so every folder mark on a dark theme came out the SAME hue, the
 * reported "icon folder di sidebar jadi sama warnanya". Light never showed it
 * because there the same selector is (0,3,1) and the accent wins. Escalating
 * the accent's specificity would have been a tie waiting for the next attribute;
 * stating "a weight does not apply to the user's own colour" removes the
 * competition instead.
 */
function projectAccentRules(): string[] {
  return [
    ':root[data-icon-style="color"] .project-accent-mark { color: var(--project-accent); }',
  ];
}

/**
 * An INVERTED surface: `bg-ink`.
 *
 * The palette's ink is the FOREGROUND, so a surface filled with it is dark on a
 * light theme and light on a dark one — the opposite of paper in both. A hue
 * picked for paper is therefore wrong on it in both directions: measured on the
 * primary `New Session` button, `rgb(129,179,228)` on `rgb(171,178,191)` in
 * `one-dark-pro-soft` and `rgb(31,77,122)` on `rgb(20,19,16)` in `paper` — the
 * reported "icon + tidak terlihat di dark mode".
 *
 * Swapping the variant's hue is not enough, and the measurement says why: the
 * ink is not an extreme in most palettes. `solarized-light`'s ink is `#586e75`
 * and `solarized-dark`'s is `#93a1a1`, both mid-tones, so no single hue at any
 * lightness clears 3:1 on every palette's inverted surface (measured worst case
 * 1.59 at `hsl(65% 70%)`). What DOES clear it is the surface's own foreground —
 * `bg-ink` is always paired with `text-canvas`/`text-paper`, and the palette
 * guarantees that pair. So the icon inherits it: `color: currentColor`, which on
 * this element resolves to the inherited value (the surface's text colour), not
 * to a hue.
 *
 * That is the rule for an inverted surface generally: it already declares its
 * foreground, so the icon takes it instead of inventing a second one.
 */
function invertedSurfaceRules(): string[] {
  return [
    ':where([data-icon-style="color"]) :where(.bg-ink) :where(svg.lucide) { color: currentColor; }',
    ':where([data-icon-style="color"]) :where(.bg-ink) :where([data-plugin-mark]) { --plugin-color: currentColor; }',
  ];
}

/**
 * A PLUGIN's mark: the hue is computed at runtime from its name
 * (`hashHue`), so it cannot be a generated row — the component sets
 * `--icon-hue` inline and these two rules turn it into paint.
 */
function pluginMarkRules(): string[] {
  return [
    // A DECLARED colour wins over the hashed hue — the plugin's own brand, when
    // its manifest names one. It is still gated on the colour mode, so
    // monochrome leaves every mark in the palette ink.
    `:where([data-icon-style="color"]) :where([data-plugin-mark]) { --plugin-color: var(--plugin-declared-light, ${iconHuePaint('light')}); }`,
    `:where([data-icon-style="color"][data-theme-variant="dark"]) :where([data-plugin-mark]) { --plugin-color: var(--plugin-declared-dark, ${iconHuePaint('dark')}); }`,
  ];
}

/**
 * `text-ink/60` is a WEIGHT, not a colour choice.
 *
 * The settings sidebar, the composer toolbar and a few hundred other call sites
 * write `text-ink/40`-`/80` to mute an icon. That is "the ink, quieter" — the
 * caller did not pick a colour — but a utility class is (0,1,0) and the hue
 * rules are `:where()` (0,0,0), so the mute won and every muted icon stayed ink
 * in the colour mode ("icon di setting modal kenapa gk full color").
 *
 * The mute is reproduced by mixing toward the INK, not toward transparency. Two
 * reasons, both measured. Transparency is the wrong lever for a graphic: a hue at
 * 40% alpha is 1.56:1 (light) / 1.77:1 (dark) against its surface, while the
 * `text-ink/40` it replaces was already only 1.71 / 2.05 — so the colour mode
 * would have made every muted icon less legible than before. Mixing toward the
 * ink instead keeps the same "mostly ink, quieter" reading AND lands at 3.89:1
 * worst case across every palette (`hue 80% + ink 20%`), 4.65:1 at the muted end.
 *
 * Specificity `svg.lucide[class*=…]` (0,2,1) beats the utility (0,1,0) on its
 * own; the `!` is not needed and is not used anywhere in this sheet.
 */
function inkWeightRules(): string[] {
  const steps = [25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90];
  const rules: string[] = [];
  for (const variant of ['light', 'dark'] as const) {
    const gate = variant === 'dark'
      ? '[data-icon-style="color"][data-theme-variant="dark"]'
      : '[data-icon-style="color"]';
    const paint = iconHuePaint(variant);
    // The un-suffixed `text-ink` is the full-strength ink.
    rules.push(`${gate} svg.lucide:not(.project-accent-mark)[class~="text-ink"] { color: ${paint}; }`);
    for (const step of steps) {
      // `NN%` of hue over the ink: the caller's mute survives as "mostly ink",
      // and the hue is what the mode added.
      rules.push(
        `${gate} svg.lucide:not(.project-accent-mark)[class*="text-ink/${step}"] { color: color-mix(in srgb, ${paint} ${step}%, var(--theme-ink)); }`,
      );
    }
  }
  return rules;
}

/** The signal colours, which beat the hue because they are stated after it. */
function signalRules(): string[] {
  return ICON_TINT_ROWS.map(
    ({ className, role }) =>
      `:where([data-icon-style="color"]) :where(svg.${className}) { color: ${ICON_TINT_TOKENS[role]}; }`,
  );
}

/** Cached: the tables are fixed for the life of the process. */
let cached: string | null = null;

export function iconPaintStyleSheet(): string {
  cached ??= [
    `/* Generated from src/shared/lib/icons — do not edit by hand. Default hue ${DEFAULT_ICON_HUE}. */`,
    // Stated HERE because this sheet loads first: a bare `@layer utilities`
    // block would otherwise become the lowest layer and demote every utility.
    '@layer theme, base, components, utilities;',
    '@layer utilities {',
    ...hueRules(),
    ...inkWeightRules(),
    ...panelMarkRules(),
    ...signalRules(),
    ...pluginMarkRules(),
    // Last: same specificity as everything above, so order is what makes an
    // inverted surface win over the paper-tuned paint.
    ...invertedSurfaceRules(),
    ...projectAccentRules(),
    ...monochromeRules(),
    ...toolCardRules(),
    ...Object.entries(BRAND_COLORS).flatMap(([name, entry]) =>
      brandRules(`svg[data-provider="${name}"]`, entry.light, entry.dark),
    ),
    ...Object.entries(FILE_BRAND_COLORS).flatMap(([name, entry]) =>
      brandRules(`svg[data-file-brand="${name}"]`, entry.light, entry.dark),
    ),
    '}',
  ].join('\n');
  return cached;
}
