/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The functional-glyph colour table.
 *
 * Four facts are worth pinning, and each is invisible until wrong:
 *
 * - **The class conversion matches what Lucide emits.** `Trash2` is an alias of
 *   `trash` (class `lucide-trash-2`), `AlertTriangle` of `triangle-alert`, so a
 *   table keyed on the IMPORT name is only useful if the kebab translation lands
 *   on a class the component really carries. Every row is RENDERED here rather
 *   than trusted.
 * - **The hue table matches the imports.** It is generated from `src/`; a stale
 *   copy would leave a newly added icon on the default hue, which looks like the
 *   mode half-applied. `scripts/icon-tints.mjs --check` is the same comparison.
 * - **Every generated hue clears the non-text contrast floor** on every palette
 *   of its variant, at the lightness `ICON_HUE_PAINT` states. That is the whole
 *   reason the lightness is 30% / 70% and not something prettier.
 * - **A signal icon is never also a hue row**, so the signal colour cannot be
 *   shadowed by a `--icon-hue` on the same element.
 */

import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import * as lucide from 'lucide-preact';
import {
  assignPanelHues,
  DEFAULT_ICON_HUE,
  ICON_HUE_PAINT,
  ICON_HUE_ROWS,
  ICON_TINTS,
  ICON_TINT_ROWS,
  ICON_TINT_TOKENS,
  iconHue,
  hashHue,
  iconHueColor,
  iconHuePaint,
  iconTintRole,
  iconTone,
  kebabIconName,
  lucideClassName,
} from '@/shared/lib/icons/tint';
import { ICON_HUES, ICON_TONES } from '@/shared/lib/icons/tint-hues.generated';
import { oklchOf } from '@/shared/lib/icons/icon-tone';
import { THEMES } from '@/shared/lib/theme/catalog';
import { BRAND_CONTRAST_FLOOR, contrastRatio } from '@/shared/lib/theme/legibility';

const DOM_GLOBALS = ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'Event'] as const;
const nativeGlobals: Partial<Record<(typeof DOM_GLOBALS)[number], unknown>> = {};
let container: HTMLElement;

beforeEach(() => {
  const win = new Window({ url: 'http://localhost' });
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (!(key in nativeGlobals)) nativeGlobals[key] = win[key as keyof Window];
    target[key] = win[key as keyof Window];
  }
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  render(null, container);
  container.remove();
});

afterAll(() => {
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (key in nativeGlobals) target[key] = nativeGlobals[key];
    else delete target[key];
  }
});

/** `hsl(<hue> <sat>% <light>%)` as a hex, so contrast can be measured. */
function hslHex(hue: number, saturation: number, lightness: number): string {
  const s = saturation / 100;
  const l = lightness / 100;
  const k = (n: number) => (n + hue / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const channel = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const toHex = (value: number) =>
    Math.round(Math.min(1, Math.max(0, value)) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${toHex(channel(0))}${toHex(channel(8))}${toHex(channel(4))}`;
}



describe('kebabIconName', () => {
  test('lowercase, camel and digit boundaries', () => {
    expect(kebabIconName('Trash2')).toBe('trash-2');
    expect(kebabIconName('AlertTriangle')).toBe('alert-triangle');
    expect(kebabIconName('ChevronsUpDown')).toBe('chevrons-up-down');
    expect(kebabIconName('BarChart3')).toBe('bar-chart-3');
    expect(kebabIconName('CircleQuestionMark')).toBe('circle-question-mark');
    expect(kebabIconName('ZoomIn')).toBe('zoom-in');
    expect(kebabIconName('Cpu')).toBe('cpu');
    expect(kebabIconName('X')).toBe('x');
    expect(kebabIconName('Settings2')).toBe('settings-2');
  });

  test('the class is the kebab name behind the component prefix', () => {
    expect(lucideClassName('Trash2')).toBe('lucide-trash-2');
  });
});

describe('the signal table', () => {
  test('every row names an icon this build can import', () => {
    for (const name of Object.keys(ICON_TINTS)) {
      expect((lucide as Record<string, unknown>)[name], `${name} is not a lucide export`).toBeDefined();
    }
  });

  test('every row renders the class the stylesheet keys on', () => {
    for (const name of Object.keys(ICON_TINTS)) {
      const Icon = (lucide as unknown as Record<string, (props: object) => unknown>)[name] as (props: object) => unknown;
      render(h(Icon as never, { 'aria-hidden': true }), container);
      const svg = container.querySelector('svg');
      expect(svg, `${name} draws an svg`).not.toBeNull();
      expect(svg?.classList.contains(lucideClassName(name)), `${name} -> ${lucideClassName(name)}`).toBe(true);
      render(null, container);
    }
  });

  test('an unlisted icon has no role, so it takes its own hue', () => {
    expect(iconTintRole('Sparkles')).toBeNull();
  });

  test('a signal role answers its own token', () => {
    expect(iconTintRole('Trash2')).toBe('error');
    expect(iconTintRole('CheckCircle2')).toBe('success');
    expect(iconTintRole('Hourglass')).toBe('warning');
    expect(iconTintRole('Info')).toBe('info');
  });

  test('every role paints a theme token, never a hex', () => {
    for (const role of new Set(Object.values(ICON_TINTS))) {
      expect(ICON_TINT_TOKENS[role], role).toMatch(/^var\(--theme-[a-z]+\)$/);
    }
  });

  test('the signal rows are unique, so no rule can be shadowed', () => {
    const classes = ICON_TINT_ROWS.map((row) => row.className);
    expect(new Set(classes).size).toBe(classes.length);
  });
});

describe('the generated hues', () => {
  test('the table has one entry per imported, non-signal icon', () => {
    expect(Object.keys(ICON_HUES).length).toBeGreaterThan(100);
    for (const name of Object.keys(ICON_TINTS)) {
      expect(ICON_HUES[name], `${name} is a signal and must not carry a hue`).toBeUndefined();
    }
  });

  test('every hue is a step on the 36-hue wheel', () => {
    for (const [name, hue] of Object.entries(ICON_HUES)) {
      expect(hue % 10, name).toBe(0);
      expect(hue, name).toBeGreaterThanOrEqual(0);
      expect(hue, name).toBeLessThan(360);
    }
  });

  test('neighbouring icons are not all the same colour', () => {
    const hues = new Set(Object.values(ICON_HUES));
    // The whole point of a per-icon hue: a dense list must not be one colour.
    expect(hues.size).toBeGreaterThan(20);
  });

  test('the hue table matches the icons this repo imports', async () => {
    // The generator is the source of truth; running its `--check` here is what
    // makes a stale table a test failure instead of a review miss.
    //
    // `Bun.fileURLToPath`, not `URL.pathname`: on a Windows host the pathname
    // is `/D:/a/kabmo/kabmo/`, which no process can open, so the spawn failed
    // for a reason that had nothing to do with the table — measured on the
    // Windows gate, where this case failed while every other row passed.
    //
    // The script is resolved THROUGH the URL rather than by string-joining onto
    // the directory: `fileURLToPath` keeps a trailing separator (`…/kabmo/`),
    // and a hand-written join would then carry one separator style into a path
    // the other half spelled the other way.
    const repoUrl = new URL('../../../..', import.meta.url);
    const repoRoot = Bun.fileURLToPath(repoUrl);
    const script = Bun.fileURLToPath(new URL('scripts/icon-tints.mjs', repoUrl));
    const check = Bun.spawnSync(['bun', 'run', script, '--check'], {
      cwd: repoRoot,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    expect(check.exitCode, check.stderr.toString()).toBe(0);
  });

  test('every light tone clears the non-text floor on every light palette', () => {
    // The tone is SOLVED per hue (see `icon-tone.ts`); this is the property that
    // let the mode carry 39% more chroma without losing a single row, so it is
    // pinned per palette rather than against one hex.
    const papers = THEMES.filter((theme) => theme.variant === 'light').map((theme) => theme.paper);
    for (const [hue, tone] of Object.entries(ICON_TONES)) {
      expect(tone, hue).toMatch(/^#[0-9a-f]{6}$/);
      const worst = Math.min(...papers.map((paper) => contrastRatio(tone, paper)));
      expect(worst, `hue ${hue} (${tone})`).toBeGreaterThanOrEqual(BRAND_CONTRAST_FLOOR);
    }
  });

  test('the dark hue still clears the floor at its one stated pair', () => {
    // Dark is deliberately untouched: it reads bright already, and raising its
    // chroma would only invert the complaint.
    const { saturation, lightness } = ICON_HUE_PAINT.dark;
    const papers = THEMES.filter((theme) => theme.variant === 'dark').map((theme) => theme.paper);
    for (const hue of new Set(Object.values(ICON_HUES))) {
      const color = hslHex(hue, saturation, lightness);
      const worst = Math.min(...papers.map((paper) => contrastRatio(color, paper)));
      expect(worst, `hue ${hue} (${color})`).toBeGreaterThanOrEqual(BRAND_CONTRAST_FLOOR);
    }
  });

  test('a light tone carries MORE chroma than the pair it replaced', () => {
    // The report — "warna icon di mode full color ketika light mode kelihatan
    // kusem" — is this measurement, and nothing else: the old pair maxed out at
    // OKLCH chroma 0.075 on the muddiest hue because one saturation had to suit
    // every hue on the wheel. Solving per hue is what buys the colour back, and
    // this is the assertion that would fail if a future edit quietly put a
    // uniform pair back.
    const hues = Object.keys(ICON_TONES).map(Number);
    const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
    const before = hues.map((hue) => oklchOf(hslHex(hue, ICON_HUE_PAINT.light.saturation, ICON_HUE_PAINT.light.lightness)).chroma);
    const after = hues.map((hue) => oklchOf(ICON_TONES[hue]!).chroma);
    expect(mean(after)).toBeGreaterThan(mean(before) * 1.3);
    // Every single hue must improve — a table that traded one muddy row for
    // another would still pass the mean.
    for (const hue of hues) {
      expect(oklchOf(ICON_TONES[hue]!).chroma, `hue ${hue}`).toBeGreaterThan(
        oklchOf(hslHex(hue, ICON_HUE_PAINT.light.saturation, ICON_HUE_PAINT.light.lightness)).chroma,
      );
    }
  });

  test('a light tone keeps its hue, so a row does not change colour', () => {
    // Solved in OKLCH, but the hue is the OKLCH angle of the OLD paint: a tone
    // that drifted would recolour every icon in the app, which is not what
    // "more colour" means.
    for (const [hue, tone] of Object.entries(ICON_TONES)) {
      const before = oklchOf(hslHex(Number(hue), ICON_HUE_PAINT.light.saturation, ICON_HUE_PAINT.light.lightness)).hue;
      const after = oklchOf(tone).hue;
      const circular = Math.min(Math.abs(before - after), 360 - Math.abs(before - after));
      expect(circular, `hue ${hue} (${tone})`).toBeLessThan(12);
    }
  });

  test('the light tone is a table lookup, not a solve, and it snaps to the wheel', () => {
    expect(iconTone(120)).toBe(ICON_TONES[120]!);
    // `hashHue` only produces wheel steps, but a stored or plugin name could
    // still reach here with something else; the nearest step keeps it a colour.
    expect(iconTone(124)).toBe(ICON_TONES[120]!);
    expect(iconTone(356)).toBe(ICON_TONES[0]!);
    expect(iconTone(-10)).toBe(ICON_TONES[350]!);
  });

  test('the paint rule and the concrete colour share one formula', () => {
    // The stylesheet leaves the hue to `--icon-hue`; the settings preview needs a
    // real colour. Both must come from the same numbers, or the preview lies.
    // LIGHT reads the solved `--icon-tone` (falling back to the old pair), which
    // is why it is not a bare `hsl()` any more.
    const { saturation, lightness } = ICON_HUE_PAINT.dark;
    expect(iconHuePaint('light')).toBe(
      `var(--icon-tone, hsl(var(--icon-hue, ${DEFAULT_ICON_HUE}) ${ICON_HUE_PAINT.light.saturation}% ${ICON_HUE_PAINT.light.lightness}%))`,
    );
    expect(iconHuePaint('dark')).toBe(`hsl(var(--icon-hue, ${DEFAULT_ICON_HUE}) ${saturation}% ${lightness}%)`);
    expect(iconHueColor(120, 'light')).toBe(ICON_TONES[120]!);
    expect(iconHueColor(120, 'dark')).toBe(`hsl(120 ${saturation}% ${lightness}%)`);
  });

  test('the table is exactly what the runtime hash produces', () => {
    // One formula for both: a plugin's mark is coloured by `hashHue` at runtime,
    // so if the generated rows drifted from it, an installed plugin would sit on
    // a different wheel than the glyphs beside it.
    for (const [name, hue] of Object.entries(ICON_HUES)) {
      expect(hashHue(name), name).toBe(hue);
    }
  });

  test('a plugin name gets a stable hue on the same wheel', () => {
    expect(hashHue('Demo Plugin')).toBe(hashHue('Demo Plugin'));
    expect(hashHue('Demo Plugin')).not.toBe(hashHue('Other Plugin'));
    for (const name of ['Demo', 'Session Info', 'git-forge', 'Stats — CPU & RAM']) {
      expect(hashHue(name) % 10, name).toBe(0);
      expect(hashHue(name), name).toBeLessThan(360);
    }
  });

  test('the rail gives every panel its OWN hue, even when two hashes collide', () => {
    // Fourteen buttons on a 36-slot wheel collide about nine times in ten
    // (birthday bound) — measured, three right-rail icons shared one blue.
    const ids = [
      'context', 'files', 'search', 'git', 'wiki', 'terminal', 'user-browser',
      'browser', 'usage', 'todo', 'plan', 'plugin:command-runner',
      'plugin:git-forge', 'plugin:stats',
    ];
    const hues = assignPanelHues(ids);

    expect(hues.size).toBe(ids.length);
    expect(new Set(hues.values()).size).toBe(ids.length);
  });

  test('the assignment does not depend on the catalog order', () => {
    // Reordering a rail must not recolour it: the ids are sorted before probing.
    const ids = ['b', 'a', 'c', 'plugin:x'];
    expect([...assignPanelHues(ids)]).toEqual([...assignPanelHues([...ids].reverse())]);
  });

  test('an unassigned panel falls back to the plain hash', () => {
    expect(assignPanelHues(['only']).get('only')).toBe(hashHue('only'));
  });

  test('an icon outside the table keeps a neutral default', () => {
    expect(iconHue('NotAnIcon')).toBe(DEFAULT_ICON_HUE);
    expect(iconHue('Trash2')).toBe(DEFAULT_ICON_HUE);
  });

  test('the rows name classes, one per hue', () => {
    const classes = ICON_HUE_ROWS.map((row) => row.className);
    expect(new Set(classes).size).toBe(classes.length);
    expect(classes.every((className) => className.startsWith('lucide-'))).toBe(true);
  });
});
