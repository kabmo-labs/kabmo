/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The PWA titlebar insets, evaluated against the two platform geometries.
 *
 * The bug this pins is arithmetic, so asserting the STRING would pass while the
 * wrong edge was reserved. The expressions are therefore substituted with real
 * env values and evaluated:
 *
 *   - macOS puts the window controls on the LEFT: `titlebar-area-x` is ~76px and
 *     `titlebar-area-width` is the rest of the window. The right inset must be
 *     the BASE padding — the old form `100vw - width` reserved 76px of dead
 *     space between the last navbar control and the window's right edge.
 *   - Windows/Linux put them on the RIGHT: `x` is 0, so both forms agree and the
 *     right inset is the overlay's own width.
 *   - A browser tab has neither: both env variables fall back, and the base
 *     padding is all that is left.
 */

import { describe, expect, test } from 'bun:test';

import {
  TITLEBAR_OVERLAY_RIGHT,
  titlebarPaddingLeft,
  titlebarPaddingRight,
} from '@/shared/lib/ui/titlebar';

const REM = 16;
const VIEWPORT = 1440;

interface Geometry {
  /** `titlebar-area-x`; absent means the browser tab's fallback. */
  x?: number;
  /** `titlebar-area-width`; absent means the fallback. */
  width?: number;
  safeLeft?: number;
  safeRight?: number;
}

/**
 * Evaluate one of the returned declarations.
 *
 * `env(name, fallback)` resolves to the geometry's value or its fallback, `vw`
 * resolves to the viewport, and `max()`/`calc()` become their JS equivalents —
 * which is exactly what a browser computes, minus unit conversion.
 */
function evaluate(expression: string, geometry: Geometry): number {
  const values: Record<string, number | undefined> = {
    'titlebar-area-x': geometry.x,
    'titlebar-area-width': geometry.width,
    'safe-area-inset-left': geometry.safeLeft,
    'safe-area-inset-right': geometry.safeRight,
  };
  const substituted = expression
    // `vw` first: the fallback inside an `env()` can itself be a viewport unit
    // (`env(titlebar-area-width, 100vw)`), and resolving it afterwards would
    // hand `parseLength` a unit it cannot read.
    .replace(/([\d.]+)vw/g, (_match, value: string) => `${(Number(value) / 100) * VIEWPORT}px`)
    .replace(
      /env\(\s*([a-z-]+)\s*,\s*([^)]+)\)/g,
      (_match, name: string, fallback: string) => `${values[name] ?? parseLength(fallback)}px`,
    )
    .replace(/max\(/g, 'Math.max(')
    .replace(/calc\(/g, '(');
  const js = substituted.replace(/([\d.]+)(px|rem)/g, (_match, value: string, unit: string) =>
    unit === 'rem' ? String(Number(value) * REM) : value,
  );
  return Function(`return (${js})`)() as number;
}

function parseLength(value: string): number {
  const match = /^([\d.]+)(px|rem)?$/.exec(value.trim());
  if (!match) throw new Error(`Unsupported length: ${value}`);
  return match[2] === 'rem' ? Number(match[1]) * REM : Number(match[1]);
}

/** macOS: traffic lights on the left, ~76px of them. */
const MACOS: Geometry = { x: 76, width: VIEWPORT - 76 };
/** Windows: controls and the app menu on the right, ~138px of them. */
const WINDOWS: Geometry = { x: 0, width: VIEWPORT - 138 };
/** A browser tab: no WCO at all, so both variables take their fallbacks. */
const TAB: Geometry = {};

describe('titlebar insets', () => {
  test('the right inset is the space AFTER the title bar area, not before it', () => {
    // The overlay sits between the area's far edge and the window's right edge.
    expect(TITLEBAR_OVERLAY_RIGHT).toContain('env(titlebar-area-x');
    expect(TITLEBAR_OVERLAY_RIGHT).toContain('env(titlebar-area-width');

    // macOS: the traffic lights are on the LEFT, so nothing may be reserved on
    // the right. This is the reported gap.
    expect(evaluate(titlebarPaddingRight('1rem'), MACOS)).toBe(REM);
    // Windows: the overlay is on the right, and its width is what clears it.
    expect(evaluate(titlebarPaddingRight('1rem'), WINDOWS)).toBe(138);
    // No WCO: the base padding, unchanged.
    expect(evaluate(titlebarPaddingRight('1rem'), TAB)).toBe(REM);
  });

  test('the left inset is the title bar area origin', () => {
    expect(evaluate(titlebarPaddingLeft('1rem'), MACOS)).toBe(76);
    expect(evaluate(titlebarPaddingLeft('1rem'), WINDOWS)).toBe(REM);
    expect(evaluate(titlebarPaddingLeft('1rem'), TAB)).toBe(REM);
  });

  test('the phone variants keep the notch insets', () => {
    expect(evaluate(titlebarPaddingLeft('0.75rem', true), { ...MACOS, safeLeft: 44 })).toBe(76);
    expect(evaluate(titlebarPaddingLeft('0.75rem', true), { x: 0, safeLeft: 44 })).toBe(44);
    // A landscape phone's right notch clears the edge on its own, and the
    // overlay's width is still honoured when it is the larger of the two.
    expect(evaluate(titlebarPaddingRight('0.75rem', true), { x: 0, width: VIEWPORT - 138, safeRight: 44 })).toBe(138);
    expect(evaluate(titlebarPaddingRight('0.75rem', true), { ...MACOS, safeRight: 44 })).toBe(44);
  });

  test('the old form is the bug, stated as a control', () => {
    // `100vw - titlebar-area-width` on macOS: the traffic lights' 76px charged
    // to the wrong edge, which is the strip the report showed.
    const buggy = `max(1rem, calc(100vw - env(titlebar-area-width, 100vw)))`;
    expect(evaluate(buggy, MACOS)).toBe(76);
    expect(evaluate(buggy, WINDOWS)).toBe(138);
  });
});
