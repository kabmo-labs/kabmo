/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The checkbox's own contract: the class is applied everywhere, and the styles
 * that make "on" and "off" readable exist.
 *
 * Both halves are pinned because they failed for different reasons. The MARKUP
 * half is a count: 22 `<input type="checkbox">` call sites across the app, and a
 * control that is styled in the sidebar but native in Settings is two controls
 * that disagree about what a checkbox looks like. The CSS half is a measurement:
 * the native unchecked box composited 1.10:1 against its row while the checked
 * one was 10.84:1 — "checkbox gk kelihatan on off nya".
 */

import { describe, expect, test } from 'bun:test';
import { Glob } from 'bun';

describe('checkbox', () => {
  test('every checkbox input carries the shared class', async () => {
    // The glob is rooted at the REPOSITORY, not at this folder: a path that
    // resolves wrong walks zero files and every assertion passes vacuously —
    // which is exactly what the first version of this test did.
    //
    // `Bun.fileURLToPath` and `new URL(file, repoUrl)`, never `URL.pathname`:
    // on Windows the pathname is `/D:/a/kabmo/kabmo/`, which walks nothing —
    // the same vacuous pass this comment warns about, arriving by another
    // route. `Bun.fileURLToPath` rather than `node:url` because this module is
    // under `src/`, where a `node:` import is not allowed.
    const repoUrl = new URL('../../../../..', import.meta.url);
    const repo = Bun.fileURLToPath(repoUrl);
    const glob = new Glob('src/client/**/*.tsx');
    const offenders: string[] = [];
    for await (const file of glob.scan({ cwd: repo })) {
      if (file.includes('.test.')) continue;
      // Comments first: `SelectionCheckbox` documents itself with the literal
      // markup (`A native <input type="checkbox"> rather than a styled span`),
      // and a scanner that reads prose reports the file that explains the rule.
      const source = (await Bun.file(new URL(file, repoUrl)).text())
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      if (!source.includes('type="checkbox"')) continue;
      // Every `<input … type="checkbox" … />` element must name the class; the
      // primitive itself imports the constant rather than spelling it.
      const inputs = source.split('<input').filter((chunk) => chunk.includes('type="checkbox"'));
      for (const chunk of inputs) {
        const tag = chunk.slice(0, chunk.indexOf('/>') + 2);
        if (!tag.includes('CHECKBOX_CLASS') && !tag.includes('kabmo-checkbox')) {
          offenders.push(`${file}: ${tag.slice(0, 60).replace(/\s+/g, ' ')}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  test('the styles state all three states in palette tokens', async () => {
    const css = await Bun.file(new URL('../../../tailwind.css', import.meta.url)).text();
    // The recipe lives in `@layer components`, NOT unlayered: an unlayered
    // `width` beat every call site's `w-4`, so six Settings rows collapsed to the
    // border box ("4x4"). A layer loses to utilities, which is the whole point.
    const layer = css.slice(css.indexOf('@layer components {'), css.indexOf('/* Dot grain texture'));
    expect(layer).toContain('.kabmo-checkbox {');
    expect(layer).toContain('appearance: none;');
    // A DEFAULT size, because `appearance: none` removes the intrinsic one.
    expect(layer).toContain('width: 0.875rem;');

    // The ring's alpha is a contrast budget: `ink 75%` is the first alpha whose
    // worst case over all 63 palettes clears WCAG's 3:1 non-text floor
    // (3.02:1 on solarized-light); 40% measured 1.71:1, which was the bug. The
    // COLOURED ring below clears 3.56:1 on the same sweep. 2px
    // rather than 1.5px because a half-pixel border antialiases into a 50% blend
    // and the intended alpha never reaches the screen.
    expect(layer).toContain('border: 2px solid color-mix(in srgb, var(--theme-ink) 75%, transparent);');
    // Checked is the full ink, so the tick is `paper` — the palette's own pair.
    expect(layer).toContain('.kabmo-checkbox:checked,');
    expect(layer).toContain('background-color: var(--theme-ink);');
    // The tick is a MASK, not a glyph: a glyph would inherit the row's text
    // colour, and these rows set `text-ink/NN` for their own reasons.
    expect(layer).toContain('background-color: var(--theme-paper);');
    expect(layer).toContain('mask: center / contain no-repeat');
    expect(layer).toContain('.kabmo-checkbox:indeterminate::after {');
  });

  test('the colour mode states on as green and off as red, and mono does not', async () => {
    const css = await Bun.file(new URL('../../../tailwind.css', import.meta.url)).text();
    // The colour mode is the one place a user asks for chroma, so the states are
    // colour there. Both are MIXED TOWARD THE INK, which is a contrast budget:
    // at full strength the ring measured 2.73:1 and the fill 1.75:1 worst case
    // over the 63 palettes, both under the 3:1 non-text floor; 75%/55% clear
    // 3.56:1 (`solarized-dark`) and 3.63:1 (`nord-light`) on the real chrome
    // composite, and the tick's `paper` clears 3.59:1 on the same fill.
    expect(css).toContain('[data-icon-style="color"] .kabmo-checkbox {\n  border-color: color-mix(in srgb, var(--theme-error) 75%, var(--theme-ink));');
    expect(css).toContain('background-color: color-mix(in srgb, var(--theme-success) 55%, var(--theme-ink));');
    // Hover stops at 85%, not the raw error colour: at 100% the ring drops to
    // 2.77:1 on `mono-light`, i.e. the highlight would be less legible than the
    // idle state it is meant to emphasise.
    expect(css).toContain('border-color: color-mix(in srgb, var(--theme-error) 85%, var(--theme-ink));');
    // Gated on the attribute: monochrome has no colour to state a state with, so
    // it keeps the ink pair the base layer declares.
    expect(css).not.toContain(':root:not([data-icon-style="color"]) .kabmo-checkbox {');
    const mono = css.slice(0, css.indexOf('[data-icon-style="color"] .kabmo-checkbox'));
    expect(mono).toContain('background-color: var(--theme-ink);');
  });
});

/**
 * The switch knob is a SHAPE, and `bg-canvas` is the app's ground.
 *
 * Under the glass surface a canvas well goes transparent — correct for a chat
 * well, fatal for a knob: measured on the plugin switches in dark, the 12px knob
 * composited to `rgba(0,0,0,0)` and the control rendered as a plain pill with no
 * "on" position at all. The mark is the switch ROLE, so any control that declares
 * itself a switch owns its knob whatever it paints it with.
 */
describe('switch knob', () => {
  test('the switch track states on/off in the same two colours as the checkbox', async () => {
    const css = await Bun.file(new URL('../../../tailwind.css', import.meta.url)).text();
    // Keyed on the ROLE and `aria-checked`, not a class: six call sites paint the
    // track with five different utilities, and none of them is the fact "on".
    expect(css).toContain('[data-icon-style="color"] [role="switch"][aria-checked="true"] {');
    expect(css).toContain('background-color: color-mix(in srgb, var(--theme-success) 55%, var(--theme-ink));');
    expect(css).toContain('[data-icon-style="color"] [role="switch"][aria-checked="false"] {');
    expect(css).toContain('background-color: color-mix(in srgb, var(--theme-error) 75%, var(--theme-ink));');
  });

  test('a knob on a switch keeps its fill under the glass surface', async () => {
    const glass = await Bun.file(new URL('../../../glass.css', import.meta.url)).text();
    expect(glass).toContain('[data-surface="glass"] .app-window [role="switch"] .bg-canvas {');
    expect(glass).toContain('background-color: var(--theme-canvas);');
    // The exemption must come AFTER the well rule it overrides, or source order
    // hands the knob back to the transparent one at equal specificity.
    const well = glass.indexOf('[data-surface="glass"] .app-window .bg-canvas:not(.app-window) {');
    const knob = glass.indexOf('[data-surface="glass"] .app-window [role="switch"] .bg-canvas {');
    expect(well).toBeGreaterThan(-1);
    expect(knob).toBeGreaterThan(well);
  });
});
