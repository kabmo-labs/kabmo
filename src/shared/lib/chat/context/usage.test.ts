/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The context indicator's band table and ring geometry.
 *
 * Both are silent when wrong: a boundary that lands on the wrong side draws the
 * same-shaped ring in the neighbouring colour, and a radius that ignores the
 * stroke clips the arc at every percentage. Every boundary is pinned explicitly,
 * including the two directions of a non-finite input.
 */

import { describe, expect, test } from 'bun:test';

import {
  CONTEXT_BAND_TONES,
  CONTEXT_CRITICAL_PERCENT,
  CONTEXT_WARNING_PERCENT,
  clampContextPercent,
  contextRingGeometry,
  contextUsageBand,
} from '@/shared/lib/chat/context/usage';

describe('contextUsageBand', () => {
  test('is healthy below 50%, warning from 50%, critical from 60%', () => {
    expect(contextUsageBand(0)).toBe('healthy');
    expect(contextUsageBand(49.9)).toBe('healthy');
    // The boundary belongs to the worse band: 50 is already amber, 60 is red.
    expect(contextUsageBand(CONTEXT_WARNING_PERCENT)).toBe('warning');
    expect(contextUsageBand(59.9)).toBe('warning');
    expect(contextUsageBand(CONTEXT_CRITICAL_PERCENT)).toBe('critical');
    expect(contextUsageBand(80)).toBe('critical');
    expect(contextUsageBand(100)).toBe('critical');
  });

  test('clamps out-of-range and non-finite shares instead of throwing', () => {
    expect(contextUsageBand(-12)).toBe('healthy');
    expect(contextUsageBand(180)).toBe('critical');
    expect(contextUsageBand(Number.NaN)).toBe('healthy');
    expect(clampContextPercent(Number.POSITIVE_INFINITY)).toBe(0);
    expect(clampContextPercent(63.4)).toBe(63.4);
  });

  test('every band has its own tone', () => {
    expect(CONTEXT_BAND_TONES.healthy.text).toBe('text-success');
    expect(CONTEXT_BAND_TONES.warning.text).toBe('text-warning');
    expect(CONTEXT_BAND_TONES.critical.text).toBe('text-error');
    expect(CONTEXT_BAND_TONES.healthy.fill).toBe('bg-success');
    expect(CONTEXT_BAND_TONES.critical.fill).toBe('bg-error');
    expect(new Set(Object.values(CONTEXT_BAND_TONES).map((tone) => tone.text)).size).toBe(3);
  });
});

describe('contextRingGeometry', () => {
  test('the radius keeps the stroke inside the box', () => {
    // An 18px box with a 2px stroke: the arc is centred on a 8px radius, so its
    // outer edge lands exactly on the viewBox edge.
    expect(contextRingGeometry(0, 18, 2).radius).toBe(8);
    expect(contextRingGeometry(0, 18, 2).circumference).toBeCloseTo(2 * Math.PI * 8);
  });

  test('the offset runs from a full circumference at 0% to zero at 100%', () => {
    const { circumference } = contextRingGeometry(0, 18, 2);
    expect(contextRingGeometry(0, 18, 2).dashOffset).toBeCloseTo(circumference);
    expect(contextRingGeometry(50, 18, 2).dashOffset).toBeCloseTo(circumference / 2);
    expect(contextRingGeometry(100, 18, 2).dashOffset).toBeCloseTo(0);
    // Past the limit the ring stays full rather than wrapping.
    expect(contextRingGeometry(140, 18, 2).dashOffset).toBeCloseTo(0);
    expect(contextRingGeometry(Number.NaN, 18, 2).dashOffset).toBeCloseTo(circumference);
  });
});
