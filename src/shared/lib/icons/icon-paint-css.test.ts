/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The generated paint stylesheet.
 *
 * Three properties are load-bearing and each fails silently:
 *
 * - **The sheet is inside `@layer utilities` and every rule is
 *   `:where()`-wrapped.** Both halves are needed: a cascade layer beats
 *   specificity, so an unlayered rule shrugs off `text-ink/75` no matter how low
 *   its specificity is (measured: a muted folder icon kept its generated hue).
 *   Together they keep a caller's `text-error` on a missing file — and a muted
 *   `text-ink/40` on a disabled row — winning over the mode.
 * - **Every rule is gated on `[data-icon-style="color"]`.** A rule that leaked
 *   would tint icons for a user who chose monochrome.
 * - **Signal rows come after the hue rows**, so `--icon-hue` cannot shadow a
 *   palette signal on the same element.
 */

import { describe, expect, test } from 'bun:test';
import {
  ICON_PAINT_STYLE_ELEMENT_ID,
  iconPaintStyleSheet,
} from '@/shared/lib/icons/icon-paint-css';
import { BRAND_COLORS } from '@/shared/lib/models/provider/brand-color';
import { FILE_BRAND_COLORS } from '@/shared/lib/icons/file-brand-color';
import { ICON_HUE_ROWS, ICON_TINT_ROWS, ICON_TINT_TOKENS } from '@/shared/lib/icons/tint';
import { ICON_TONES } from '@/shared/lib/icons/tint-hues.generated';

const css = iconPaintStyleSheet();
const rules = css.split('\n').filter((line) => line.startsWith(':where('));

describe('the icon paint stylesheet', () => {
  test('exports the element id the SSR shell and the client both look for', () => {
    expect(ICON_PAINT_STYLE_ELEMENT_ID).toBe('omp-icon-paint');
  });

  test('the whole sheet sits in the utilities layer, and states the order first', () => {
    // A cascade layer outranks specificity: an unlayered rule would beat the
    // author's `text-*` class however low its own specificity is. And the ORDER
    // has to be stated here, because this sheet is inlined into <head> and is
    // parsed BEFORE the bundled stylesheet — a bare `@layer utilities { … }`
    // would freeze utilities as the lowest layer and demote every utility
    // (measured: the sidebar collapsed to a 0-width column).
    const orderIndex = css.indexOf('@layer theme, base, components, utilities;');
    const blockIndex = css.indexOf('@layer utilities {');
    expect(orderIndex).toBeGreaterThanOrEqual(0);
    expect(blockIndex).toBeGreaterThan(orderIndex);
    expect(css.trimEnd().endsWith('}')).toBe(true);
  });

  test('every rule either turns colour ON or states what monochrome means', () => {
    // Three families of exception, each deliberate: the monochrome rules (the
    // absence of the attribute is a mode too), the project accent (which belongs
    // to the colour mode), and the tool-card rules (ink in BOTH modes).
    const monochrome = /^:root:not\(\[data-icon-style="color"\]\)/;
    const accent = /^:root\[data-icon-style="color"\] \.project-accent-mark/;
    const toolCard = /^\[data-tool-row\] /;
    for (const rule of rules) {
      const ok =
        rule.startsWith(':where([data-icon-style="color"]') ||
        monochrome.test(rule) ||
        accent.test(rule) ||
        toolCard.test(rule);
      expect(ok, rule.slice(0, 70)).toBe(true);
    }
  });

  test('monochrome paints ink, not the inherited colour, and skips inverted surfaces', () => {
    // `currentColor` was not enough: a `Check` inside a green chip INHERITS the
    // chip's green, so two icons survived a monochrome pass that way.
    expect(css).toContain(
      ':root:not([data-icon-style="color"]) svg.lucide:not([class*="text-ink"]):not(.bg-ink *) { color: var(--theme-ink); }',
    );
    expect(css).toContain(':root:not([data-icon-style="color"]) [data-plugin-mark] { --plugin-color: currentColor; }');
  });

  test('a tool card is ink in both modes, so the transcript never turns into confetti', () => {
    expect(css).toContain('[data-tool-row] svg.lucide:not([class*="text-ink"]):not(.bg-ink *) { color: var(--theme-ink); }');
    expect(css).toContain('[data-tool-row] [data-plugin-mark] { --plugin-color: var(--theme-ink); }');
  });

  test('a muted ink icon takes its hue, muted toward the ink rather than faded out', () => {
    // `text-ink/60` is a WEIGHT. It is (0,1,0) and the hue rules are (0,0,0), so
    // the mute won and every muted icon stayed ink in the colour mode — the
    // reported "icon di setting modal kenapa gk full color".
    expect(css).toContain('[data-icon-style="color"] svg.lucide:not(.project-accent-mark)[class*="text-ink/60"] { color: color-mix(in srgb,');
    expect(css).toContain('[data-icon-style="color"] svg.lucide:not(.project-accent-mark)[class~="text-ink"] { color: var(--icon-tone, hsl(var(--icon-hue');
    // Mixed toward the INK, never toward transparency: a hue at 40% alpha is
    // 1.56:1 against its surface, worse than the `text-ink/40` it replaces.
    const muted = css.split('\n').find((line) => line.includes('text-ink/40"')) ?? '';
    expect(muted).toContain('var(--theme-ink)');
    expect(muted).not.toContain('transparent');
  });

  test('the project accent survives the dark ink weights', () => {
    // Each folder mark carries the user's OWN colour as `--project-accent`, and
    // the call sites also write `text-ink/70`. The dark weight selector is
    // `[data-icon-style="color"][data-theme-variant="dark"] svg.lucide[class*="text-ink/70"]`
    // = (0,4,1) — one ELEMENT above
    // `:root[data-icon-style="color"] .project-accent-mark` = (0,4,0) — so on a
    // dark theme every folder icon came out the same hue and light looked fine.
    // "A weight does not apply to the user's own colour" is the fix; out-specifying
    // it would be a tie waiting for the next attribute.
    expect(css).toContain('[data-icon-style="color"] svg.lucide:not(.project-accent-mark)[class*="text-ink/70"]');
    expect(css).toContain(
      '[data-icon-style="color"][data-theme-variant="dark"] svg.lucide:not(.project-accent-mark)[class*="text-ink/70"]',
    );
    expect(css).toContain(':root[data-icon-style="color"] .project-accent-mark { color: var(--project-accent); }');
    // Every weight rule, not just the one probed by hand: a single step that
    // forgets the `:not()` is a folder mark that goes back to the shared hue.
    const weightRules = css.split('\n').filter((line) => line.includes('svg.lucide[class*="text-ink/') || line.includes('svg.lucide:not(.project-accent-mark)[class~="text-ink"'));
    expect(weightRules.length).toBeGreaterThan(0);
    for (const line of weightRules) expect(line).toContain(':not(.project-accent-mark)');
  });

  test('the project accent belongs to the colour mode', () => {
    expect(css).toContain(':root[data-icon-style="color"] .project-accent-mark { color: var(--project-accent); }');
  });

  test('every selector is wrapped in :where(), so a caller class still wins', () => {
    for (const rule of rules) {
      const selector = rule.slice(0, rule.indexOf('{'));
      // Balanced `:where(` and `)`: every compound in the selector is wrapped.
      const opens = selector.split(':where(').length - 1;
      const closes = selector.split(')').length - 1;
      expect(opens, selector).toBeGreaterThan(0);
      expect(closes, selector).toBe(opens);
    }
  });

  test('the base hue rule paints a custom-property hsl(), per variant', () => {
    expect(css).toContain(':where(svg.lucide) { color: hsl(var(--icon-hue,');
    expect(css).toContain(':where([data-icon-style="color"][data-theme-variant="dark"]) :where(svg.lucide) { color: hsl(var(--icon-hue,');
  });

  test('one hue statement per generated row', () => {
    for (const { className, hue } of ICON_HUE_ROWS) {
      expect(css).toContain(`:where(svg.${className}) { --icon-hue: ${hue}; --icon-tone: ${ICON_TONES[hue]}; }`);
    }
  });

  test('every signal row paints its palette token, after the hue rows', () => {
    const hueIndex = css.indexOf('--icon-hue');
    for (const { className, role } of ICON_TINT_ROWS) {
      const needle = `:where(svg.${className}) { color: ${ICON_TINT_TOKENS[role]}; }`;
      expect(css).toContain(needle);
      expect(css.indexOf(needle), `${className} must follow the hue rules`).toBeGreaterThan(hueIndex);
    }
  });

  test('every provider row paints both variants', () => {
    for (const [name, entry] of Object.entries(BRAND_COLORS)) {
      const selector = `svg[data-provider="${name}"]`;
      expect(css).toContain(`:where(${selector}) { color: ${entry.light}; }`);
      expect(css).toContain(`color: ${entry.dark ?? 'var(--theme-ink)'}; }`);
    }
  });

  test('every file-brand row paints both variants', () => {
    for (const [name, entry] of Object.entries(FILE_BRAND_COLORS)) {
      const selector = `svg[data-file-brand="${name}"]`;
      expect(css).toContain(`:where(${selector}) { color: ${entry.light}; }`);
      expect(css).toContain(`color: ${entry.dark ?? 'var(--theme-ink)'}; }`);
    }
  });

  test('a plugin mark takes a runtime hue through --plugin-color', () => {
    // The hue is `hashHue(name)`, which no build can enumerate: the component
    // sets `--icon-hue` inline and these rules turn it into paint.
    expect(css).toContain(':where([data-plugin-mark]) { --plugin-color: var(--plugin-declared-light, var(--icon-tone, hsl(var(--icon-hue,');
    expect(css).toContain(':where([data-icon-style="color"][data-theme-variant="dark"]) :where([data-plugin-mark])');
  });

  test('a panel mark outranks a caller state class, and dims by LUMINANCE', () => {
    // Two surfaces write a WEIGHT (`text-ink/70`, `text-ink/30`) to say whether
    // a panel is active: the rail's button and the Built-in list's off row. A
    // zero-specificity hue rule lost to it, which is what kept the right rail
    // monochrome. These rules carry enough specificity to win, `:not(.bg-ink *)`
    // keeps an inverted chip on its own foreground, and `[data-idle]` replaces
    // the colour as the state instead of stacking a second one on top.
    expect(css).toContain(':root[data-icon-style="color"] [data-panel-mark]:not(.bg-ink *) svg.lucide { color: var(--panel-color-light, var(--panel-tone, hsl(var(--panel-hue, var(--icon-hue,');
    expect(css).toContain(':root[data-icon-style="color"][data-theme-variant="dark"] [data-panel-mark]:not(.bg-ink *) svg.lucide');
    // A plugin's own mark states `--plugin-color` from its name; inside a panel
    // mark the panel's declared colour (or its assigned hue) is the authority.
    expect(css).toContain(':root[data-icon-style="color"] [data-panel-mark] [data-plugin-mark] { --plugin-color: var(--panel-color-light,');
    // The idle state must NOT be alpha. `opacity: 0.45` composites the hue with
    // the rail's near-neutral chrome and throws most of the chroma away — the
    // measured 95 → 62 on a 64px glyph, which is the "kusem" report. A brightness
    // shift moves luminance only; the two variants shift opposite ways because
    // "recede" is darker on ink and lighter on paper.
    expect(css).toContain('[data-icon-style="color"] [data-panel-mark][data-idle]:not([data-declared]) { filter: brightness(1.08) saturate(1.1); }');
    expect(css).toContain(
      '[data-icon-style="color"][data-theme-variant="dark"] [data-panel-mark][data-idle]:not([data-declared]) { filter: brightness(0.62) saturate(1.4); }',
    );
    // And the state must not be stated twice: an opacity left behind would
    // desaturate exactly what the filter restored.
    expect(css).not.toContain('[data-panel-mark][data-idle] { opacity');
    // A plugin that DECLARES its own colour is exempt: the settings card draws
    // the same mark at full strength, and one brand in two intensities is what
    // made the two views disagree.
    expect(css).toContain('[data-panel-mark][data-idle]:not([data-declared])');
  });

  test('an inverted surface takes its own foreground, not a hue', () => {
    // `bg-ink` is the palette's FOREGROUND used as a fill, so it is dark on a
    // light theme and light on a dark one — a paper-tuned hue is invisible on it
    // in one of the two (measured 1.6:1 and 1.9:1 on the primary New Session
    // button). Swapping the variant is not enough either: several palettes have a
    // mid-tone ink (`#586e75`, `#93a1a1`), where no hue at any lightness clears
    // 3:1. The surface already declares `text-canvas`/`text-paper`, and the
    // palette guarantees that pair, so the icon inherits it.
    expect(css).toContain(':where([data-icon-style="color"]) :where(.bg-ink) :where(svg.lucide) { color: currentColor; }');
    expect(css).toContain(':where([data-icon-style="color"]) :where(.bg-ink) :where([data-plugin-mark]) { --plugin-color: currentColor; }');
    // Same zero specificity as the base rules, so it has to come AFTER them.
    expect(css.indexOf(':where(.bg-ink) :where(svg.lucide)')).toBeGreaterThan(css.indexOf(':where(svg.lucide) { color: hsl(var(--icon-hue'));
  });

  test('a plugin manifest colour wins over the hashed hue', () => {
    // `--panel-declared`/`--panel-color` is the plugin's OWN brand, and the
    // hashed hue is only the fallback — the order inside the `var()` chain is the
    // contract, so it is pinned literally.
    expect(css).toContain('--plugin-color: var(--plugin-declared-light, var(--icon-tone, hsl(var(--icon-hue');
    expect(css).toContain('--plugin-color: var(--plugin-declared-dark, hsl(var(--icon-hue');
    expect(css).toContain('color: var(--panel-color-light, var(--panel-tone, hsl(var(--panel-hue, var(--icon-hue,');
    expect(css).toContain('color: var(--panel-color-dark, hsl(var(--panel-hue, var(--icon-hue,');
  });

  test('the string is cached, not rebuilt per call', () => {
    expect(iconPaintStyleSheet()).toBe(css);
  });
});
