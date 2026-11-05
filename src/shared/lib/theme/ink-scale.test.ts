/**
 * The muted ink ladder: a lightness ramp plus one solved AA floor. The shape is
 * what broke twice, so it is pinned; see `TEXT_CONTRAST_FLOOR`.
 */

import { describe, expect, test } from 'bun:test';

import {
  MUTED_CONTRAST_FLOOR,
  MUTED_STEPS,
  TEXT_CONTRAST_FLOOR,
  contrastBetween,
  inkScale,
  onInkTextColor,
  signalTextColor,
  worstTextContrast,
} from '@/shared/lib/theme/ink-scale';
import { SIGNAL_SLOTS } from '@/shared/lib/theme/ink-scale';
import { mixHex } from '@/shared/lib/theme/color';
import { themeStyleSheet } from '@/shared/lib/theme/css';
import { THEMES } from '@/shared/lib/theme/catalog';

const paper = THEMES.find((theme) => theme.id === 'paper')!;
const solarized = THEMES.find((theme) => theme.id === 'solarized-light')!;

describe('the muted ladder', () => {
  test('the ramp is the ink at that percentage over the paper', () => {
    // The class name IS the value. `text-ink/40` means 40% ink, and a ramp that
    // quietly stops meaning that is a ramp nobody can reason about.
    for (const theme of THEMES) {
      const ladder = inkScale(theme).ladder;
      MUTED_STEPS.forEach((step, index) => {
        expect(ladder[index], `${theme.id}/$${step}`).toBe(
          mixHex(theme.paper, theme.ink, step / 100),
        );
      });
    }
  });

  test('fifteen steps are fifteen DISTINCT values on a palette with headroom', () => {
    // The failure this catches: bucketing made `/30` and `/45` the same colour.
    for (const theme of THEMES) {
      const ladder = inkScale(theme).ladder;
      expect(ladder.length).toBe(MUTED_STEPS.length);
      if (theme.id === 'solarized-light') continue; // too little range to spread
      expect(new Set(ladder).size, theme.id).toBe(MUTED_STEPS.length);
    }
  });

  test('the floor is a step that clears AA, and the one below it does not', () => {
    // Placed where it is NEEDED, not somewhere comfortably safe: asserting it is
    // both sufficient and minimal is what stops the number drifting.
    const ladder = inkScale(paper).ladder;
    const floorIndex = MUTED_STEPS.indexOf(TEXT_CONTRAST_FLOOR);
    expect(worstTextContrast(ladder[floorIndex], paper)).toBeGreaterThanOrEqual(
      MUTED_CONTRAST_FLOOR,
    );
    expect(worstTextContrast(ladder[floorIndex - 1], paper)).toBeLessThan(MUTED_CONTRAST_FLOOR);
  });

  test('`muted` is the lightest LEGAL step of that palette, not a fixed rung', () => {
    // The floor is `/65` on `paper`, but each palette's headroom differs — the
    // measured floor ranges from `/50` to `/90` across the 63 — so `muted` is
    // "first step that clears AA", which is the same rule applied, not a second
    // convention. On `paper` the two agree, which is why the default palette
    // anchors the design.
    for (const theme of THEMES) {
      const ladder = inkScale(theme).ladder;
      const firstLegal = ladder.find(
        (color) => worstTextContrast(color, theme) >= MUTED_CONTRAST_FLOOR,
      );
      expect(inkScale(theme).muted, theme.id).toBe(firstLegal ?? theme.ink);
      expect(worstTextContrast(inkScale(theme).muted, theme), theme.id).toBeGreaterThanOrEqual(
        MUTED_CONTRAST_FLOOR,
      );
    }
    expect(inkScale(paper).muted).toBe(inkScale(paper).ladder[MUTED_STEPS.indexOf(TEXT_CONTRAST_FLOOR)]);
  });

  test('a palette with no headroom puts its muted level on its own ink', () => {
    // `solarized-light`'s ink is 4.85:1, so nothing below it is legal. Returning
    // a lighter colour there would be reporting a contrast the palette lacks.
    expect(inkScale(solarized).muted).toBe(solarized.ink);
  });

  test('nothing in the ramp is lighter than the paper it sits on', () => {
    // A step lighter than its surface is text painted in the background colour.
    for (const theme of THEMES) {
      for (const color of inkScale(theme).ladder) {
        expect(worstTextContrast(color, theme), theme.id).toBeGreaterThan(1.2);
      }
    }
  });
});

describe('the generated stylesheet', () => {
  test('states all fifteen steps for every palette', () => {
    const css = themeStyleSheet();
    for (const step of MUTED_STEPS) {
      expect(css.match(new RegExp(`--theme-ink-${step}:`, 'g'))?.length).toBe(THEMES.length);
    }
  });

  test('the emitted values are the solved ones, not a second hand-tuned copy', () => {
    const ladder = inkScale(paper).ladder;
    MUTED_STEPS.forEach((step, index) => {
      expect(themeStyleSheet()).toContain(`--theme-ink-${step}: ${ladder[index]};`);
    });
  });

  test('the retired bucketed tokens are gone, so no stale value can be read', () => {
    const css = themeStyleSheet();
    expect(css).not.toContain('--theme-ink-muted:');
    expect(css).not.toContain('--theme-ink-muted-2:');
  });
});

describe('text on an inverted surface', () => {
  test('every palette clears AA on bg-ink once solved', () => {
    // Measured before: `text-canvas/60` over `bg-ink` read 2.91:1 on
    // `solarized-light`, and even the full canvas only reached 4.99 there.
    const failing = THEMES.filter(
      (theme) => contrastBetween(onInkTextColor(theme), theme.ink) < 4.5 - 0.001,
    );
    expect(failing.map((theme) => theme.id)).toEqual([]);
  });

  test('a palette whose canvas already reads keeps its own canvas', () => {
    expect(onInkTextColor(paper)).toBe(paper.canvas);
  });
});

describe('signal colours as text', () => {
  test('every slot clears AA on every palette once solved', () => {
    // Measured before: `text-success` 1.75:1 on `nord-light`, `text-warning`
    // 1.53:1 on `carbonfox-light`, every slot failing on 14-22 of 63 palettes.
    const failing: string[] = [];
    for (const theme of THEMES) {
      for (const slot of SIGNAL_SLOTS) {
        if (worstTextContrast(signalTextColor(theme, slot), theme) < 4.5 - 0.001) {
          failing.push(`${theme.id}/${slot}`);
        }
      }
    }
    expect(failing).toEqual([]);
  });

  test('a palette whose signal already reads keeps its own hex', () => {
    expect(signalTextColor(paper, 'error')).toBe(paper.error);
  });
});
