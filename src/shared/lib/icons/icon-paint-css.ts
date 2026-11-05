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
import { inkWeightRules } from '@/shared/lib/icons/icon-paint-weight';
import { authorColourRules, solidSignalFillRules } from '@/shared/lib/icons/icon-paint-authority';
import { FILE_BRAND_COLORS } from '@/shared/lib/icons/file-brand-color';
import {
  DEFAULT_ICON_HUE,
  ICON_HUE_ROWS,
  ICON_TINT_ROWS,
  ICON_TINT_TOKENS,
  iconHuePaint,
  iconTone,
} from '@/shared/lib/icons/tint';

/** The `<style>` element's id: the SSR shell writes it, the client checks it. */
export const ICON_PAINT_STYLE_ELEMENT_ID = 'omp-icon-paint';

/** Both rules for one brand, since a brand colour has two values. */
function brandRules(selector: string, light: string, dark: string | null): string[] {
  return [
    `:where([data-icon-style="color"]) :where(${selector}) { --icon-color: ${light}; }`,
    `:where([data-icon-style="color"][data-theme-variant="dark"]) :where(${selector}) { --icon-color: ${dark ?? 'var(--theme-ink)'}; }`,
  ];
}

/** The hue a functional glyph is painted with, per variant. */
function hueRules(): string[] {
  const rules = [
    // `--icon-paint`, not `color`: WHICH colour an icon is and HOW LOUD it is are
    // two decisions, and stating them as one `color` makes them compete on
    // specificity. The weight rules below multiply the chroma of whatever this
    // resolves to, so they cannot overwrite a signal token by winning a cascade
    // race (which is exactly what they did — see `inkWeightRules`).
    `:where([data-icon-style="color"]) :where(svg.lucide) { --icon-color: ${iconHuePaint('light')}; }`,
    `:where([data-icon-style="color"][data-theme-variant="dark"]) :where(svg.lucide) { --icon-color: ${iconHuePaint('dark')}; }`,
  ];
  for (const { className, hue } of ICON_HUE_ROWS) {
    // BOTH variants on one element, so the variant rule below only has to pick
    // between two custom properties. Stamping `--icon-tone` alone is what left
    // dark on a single `hsl()` pair for every hue.
    rules.push(
      `:where([data-icon-style="color"]) :where(svg.${className}) { --icon-hue: ${hue}; --icon-tone: ${iconTone(hue, 'light')}; --icon-tone-dark: ${iconTone(hue, 'dark')}; }`,
    );
  }
  return rules;
}

/**
 * The paint itself. Stated ONCE, after the sources above, so every rule that
 * decides a colour only has to set `--icon-color`.
 *
 * `color` rather than a second fallback inside each source: it is the one
 * property a caller can also set (`text-ink/60`), and this block is gated, so an
 * icon outside the colour mode keeps the author's class.
 *
 * **The selector covers all three icon families, not just `.lucide`.** Provider
 * and file-type marks are their own `<svg>` and carry no `lucide` class, so a
 * `.lucide`-only paint rule left them inheriting their parent's text colour —
 * measured, a brand mark computed `oklab(0.523 -0.022 -0.018 / 0.8)` (its row's
 * muted ink) while its `--icon-color` held the brand hex. `:is()` costs nothing:
 * each argument is (0,1,1), so the whole selector stays (0,2,1) and still beats
 * a single utility.
 */
function paintRules(): string[] {
  return [
    // `--icon-paint` is derived from `--icon-color`, which every source above
    // sets. The indirection is what lets a WEIGHT rule (see `inkWeightRules`)
    // transform the colour without knowing which source produced it — a signal
    // token, a solved tone, a brand hex or a panel's own colour all flow through
    // the same two lines.
    //
    // NOT `:where()` on this one, unlike every other rule in the sheet. The
    // subject is the `color` property, which the call sites also set — a utility
    // like `text-ink/60` is (0,1,0) — so a zero-specificity statement lost the
    // mode entirely and every muted icon stayed monochrome ink (measured in the
    // settings modal: `--icon-paint` computed to the tone, and `color` still
    // resolved to `oklab(… / 0.6)`). (0,2,1) beats a single utility, and the
    // rules that must still override it — a panel mark, a tool card, an inverted
    // surface, the project accent — are stated after this one with more weight.
    `[data-icon-style="color"] :is(svg.lucide, svg[data-provider], svg[data-file-brand]) { --icon-paint: var(--icon-color); color: var(--icon-paint); }`,
  ];
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
    // The pair, not one value: every shipped preset is chosen to look good as a
    // SWATCH, and measured as a glyph nine of them fall below the 3:1 floor on
    // light paper — `#a3e635` reads 1.15:1, `#fbbf24` 1.27:1. The component
    // derives both values through `legiblePair`, the same rule every brand mark
    // uses, so the icon is the user's colour at a legal lightness while the
    // swatch keeps the exact hex they picked.
    ':root[data-icon-style="color"] .project-accent-mark { color: var(--project-accent); }',
    ':root[data-icon-style="color"][data-theme-variant="dark"] .project-accent-mark { color: var(--project-accent-dark, var(--project-accent)); }',
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
    // Stated at (0,2,1) to TIE with `paintRules` and win on order — `:where()`
    // would be (0,0,0) and lose to it, which is the whole reason this rule
    // exists. It sets `color` directly rather than `--icon-color`, because
    // `currentColor` resolves FROM `color`: feeding it back into the property
    // that computes `color` is a cycle the browser drops.
    '[data-icon-style="color"] .bg-ink svg.lucide { color: currentColor; }',
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

/** The signal colours, which beat the hue because they are stated after it. */
function signalRules(): string[] {
  return ICON_TINT_ROWS.map(
    ({ className, role }) =>
      `:where([data-icon-style="color"]) :where(svg.${className}) { --icon-color: ${ICON_TINT_TOKENS[role]}; }`,
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
    ...signalRules(),
    // An author's own signal class is a decision, so it is stated after the
    // table that would otherwise guess one for the same glyph.
    ...authorColourRules(),
    ...pluginMarkRules(),
    // Every `--icon-color` source is stated above this line; the paint and the
    // weight that SCALES it are stated below, in that order.
    ...paintRules(),
    ...inkWeightRules(),
    ...panelMarkRules(),
    // Last: same specificity as everything above, so order is what makes an
    // inverted surface win over the paper-tuned paint.
    ...invertedSurfaceRules(),
    ...solidSignalFillRules(),
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
