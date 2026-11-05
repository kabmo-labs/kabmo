/**
 * The `text-ink/NN` ramp, against the palettes it serves: a fixed lightness
 * ramp, plus the one solved level (`text-muted`) that clears AA everywhere.
 */

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { THEMES } from '@/shared/lib/theme/catalog';
import { themeStyleSheet } from '@/shared/lib/theme/css';
import {
  MUTED_STEPS,
  SIGNAL_SLOTS,
  TEXT_CONTRAST_FLOOR,
  inkScale,
  signalTextColor,
  worstTextContrast,
} from '@/shared/lib/theme/ink-scale';
import { parseHexColor } from '@/shared/lib/theme/color';

const CSS = readFileSync(resolve(import.meta.dir, 'tailwind.css'), 'utf8');

/** The fifteen steps the ramp has to cover, each with its own colour. */
const STEPS = MUTED_STEPS;

/** OKLab lightness, so the ramp's SHAPE is measurable rather than asserted. */
function lightness(hex: string): number {
  const color = parseHexColor(hex);
  if (!color) return Number.NaN;
  const linear = (value: number) => {
    const v = value / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const r = linear(color.r);
  const g = linear(color.g);
  const b = linear(color.b);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
}

describe('the muted-text ramp', () => {
  test('the ramp is a steady lightness ladder, not a contrast curve', () => {
    // This is the property two "fixes" destroyed. Fitting the steps to a
    // contrast target compressed the dark end (ΔL 0.193 at `/35`, 0.098 at
    // `/90`), which collapsed a tool card's header/subtitle pair and darkened
    // the composer placeholder into looking like a typed value. A constant ΔL is
    // what the eye reads as "evenly spaced ranks".
    const ladder = inkScale(THEMES.find((theme) => theme.id === 'paper')!).ladder;
    const deltas = ladder.slice(1).map((color, index) => lightness(ladder[index]) - lightness(color));
    const min = Math.min(...deltas);
    const max = Math.max(...deltas);
    expect(min).toBeGreaterThan(0.025);
    expect(max / min).toBeLessThan(1.5);
  });

  test('raising one step is always a move, and a visible one where the palette can afford it', () => {
    // A light palette's ramp darkens as the step rises; a dark palette's ramp
    // lightens. The invariant is the SIZE of the move, not its sign.
    //
    // The size is bounded by the palette's own range: `solarized-light` puts its
    // ink 4.85:1 from its paper, so fifteen steps have less room and its
    // smallest gap is 0.0198. Asserting 0.02 there would be asserting that the
    // palette has more contrast than it does.
    for (const theme of THEMES) {
      const ladder = inkScale(theme).ladder;
      const headroom = worstTextContrast(theme.ink, theme) >= 10;
      for (let index = 1; index < ladder.length; index += 1) {
        const gap = Math.abs(lightness(ladder[index - 1]) - lightness(ladder[index]));
        expect(gap, `${theme.id} /${STEPS[index]}`).toBeGreaterThan(0.015);
        if (headroom) expect(gap, `${theme.id} /${STEPS[index]}`).toBeGreaterThan(0.025);
      }
    }
  });

  test('the lightest step that carries meaning clears AA on the default palette', () => {
    const paper = THEMES.find((theme) => theme.id === 'paper')!;
    const floor = inkScale(paper).ladder[STEPS.indexOf(TEXT_CONTRAST_FLOOR)];
    expect(worstTextContrast(floor, paper)).toBeGreaterThanOrEqual(4.5);
    // And the step below it does NOT, so the boundary sits where it is needed
    // rather than somewhere comfortably safe.
    const below = inkScale(paper).ladder[STEPS.indexOf(TEXT_CONTRAST_FLOOR) - 1];
    expect(worstTextContrast(below, paper)).toBeLessThan(4.5);
  });

  test('the muted level is the same floor, not a second convention', () => {
    const paper = THEMES.find((theme) => theme.id === 'paper')!;
    expect(inkScale(paper).muted).toBe(inkScale(paper).ladder[STEPS.indexOf(TEXT_CONTRAST_FLOOR)]);
  });

  test('`text-muted` is the one rung that is legal on every palette', () => {
    // The numbered rungs are a fixed lightness ladder, so their contrast varies
    // with the palette: measured in the running app, `/65` is 5.31:1 on `paper`
    // but 3.67:1 on `one-dark-pro-soft` and 3.29:1 on `solarized-light`. Text
    // that must read uses this token, which is solved per palette.
    const failing: string[] = [];
    for (const theme of THEMES) {
      if (worstTextContrast(inkScale(theme).muted, theme) < 4.5) failing.push(theme.id);
    }
    expect(failing).toEqual([]);
    // Every palette states it once, so the OS shells and the client agree.
    expect(themeStyleSheet().match(/--theme-muted:/g)?.length).toBe(THEMES.length);
  });

  test('each rung maps to its own token, so fifteen steps stay fifteen colours', () => {
    // Bucketing onto a shared token is what collapsed the ladder twice. Every
    // palette must state all fifteen, and none may repeat a value within itself.
    const css = themeStyleSheet();
    for (const theme of THEMES) {
      const block = css.slice(css.indexOf(`html[data-theme="${theme.id}"]`));
      const closed = block.slice(0, block.indexOf('}'));
      const values = [...closed.matchAll(/--theme-ink-\d+: (#[0-9a-f]{6});/g)].map((m) => m[1]);
      expect(values.length, theme.id).toBe(STEPS.length);
      if (theme.id === 'solarized-light') continue; // too little range to spread
      expect(new Set(values).size, theme.id).toBe(STEPS.length);
    }
  });

  test('placeholder text has its own band, dimmer than a label', () => {
    expect(CSS).toContain('.placeholder-ink\\/30::placeholder');
    expect(CSS).toContain('.placeholder\\:text-ink\\/30::placeholder');
    expect(CSS).toContain('color: var(--theme-ink-30)');
  });
});

describe('the signal colours as text', () => {
  test('every slot clears AA on every palette once solved', () => {
    // Measured before: `text-success` 1.75:1 on `nord-light`, `text-warning`
    // 1.53:1 on `carbonfox-light`, and every slot failing on 14-22 of 63
    // palettes — the palette hexes are chosen for a FILL, not for an 11px word.
    const failing: string[] = [];
    for (const theme of THEMES) {
      for (const slot of SIGNAL_SLOTS) {
        const color = signalTextColor(theme, slot);
        if (worstTextContrast(color, theme) < 4.5 - 0.001) failing.push(`${theme.id}/${slot}`);
      }
    }
    expect(failing).toEqual([]);
  });

  test('a palette whose signal already reads keeps its own hex', () => {
    const paper = THEMES.find((theme) => theme.id === 'paper')!;
    expect(signalTextColor(paper, 'error')).toBe(paper.error);
    // `paper`'s info is 3.86:1 on canvas, so it IS solved — and only by as much
    // as the floor requires.
    expect(signalTextColor(paper, 'info')).not.toBe(paper.info);
    expect(worstTextContrast(signalTextColor(paper, 'info'), paper)).toBeGreaterThanOrEqual(4.5);
  });

  test('the override exists and cannot reach an icon', () => {
    expect(CSS).toContain('html :is(span, div, p, a, li, td, th');
    expect(CSS).toContain('.text-error');
    expect(CSS).toContain('var(--theme-error-text)');
    // The `:is(...)` subject list must not include `svg`, or the icon colour
    // mode would be overridden by a solved text colour.
    expect(CSS).not.toContain('svg).text-error');
  });

  test('every palette states a solved text token for all five slots', () => {
    const css = themeStyleSheet();
    for (const slot of SIGNAL_SLOTS) {
      expect(css.match(new RegExp(`--theme-${slot}-text:`, 'g'))?.length).toBe(THEMES.length);
    }
  });
});

describe('touch targets', () => {
  test('the floor is real geometry, and only on a coarse pointer', () => {
    // Measured before: 15 of 28 phone controls under 44px. An invisible
    // pseudo-element was tried first and rejected: headless Chromium never
    // reports `pointer: coarse` (so it could not be verified), and a 44px
    // overlay on a 32px button with a 4px gap steals its neighbour's taps.
    expect(CSS).toContain('@media (pointer: coarse)');
    expect(CSS).toContain('min-width: 44px');
    expect(CSS).toContain('min-height: 44px');
    // No overlapping overlay: the pseudo-element approach must not come back.
    expect(CSS).not.toContain('.tap-target::after');
  });
});

describe('motion', () => {
  test('the user\'s reduced-motion preference stops the ambient animation once', () => {
    // Measured with the preference active: `.animate-spin` still computed
    // `spin 1s infinite` and `.animate-pulse` `pulse 2s infinite`, because only
    // three hand-written places honoured it.
    const block = CSS.slice(CSS.indexOf('Motion, under the user'));
    expect(block).toContain('@media (prefers-reduced-motion: reduce)');
    expect(block).toContain('.animate-pulse');
    expect(block).toContain('animation: none');
  });
});

