/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The mounted window of a long tool output.
 *
 * The invariant that matters: the window always ends at the LAST line, because
 * a log's answer is at its tail, and the reveal walks upward without ever
 * mounting more than the ceiling. A caller hides its "show earlier" control on
 * `next === revealed`, so the ceiling must be a fixed point.
 */

import { describe, expect, test } from 'bun:test';
import {
  OUTPUT_WINDOW_INITIAL,
  OUTPUT_WINDOW_MAX,
  OUTPUT_WINDOW_STEP,
  canRevealMore,
  outputWindow,
  revealMore,
} from '@/shared/lib/chat/tool/output-window';

describe('outputWindow', () => {
  test('mounts a short payload whole', () => {
    expect(outputWindow(20, OUTPUT_WINDOW_INITIAL)).toEqual({ start: 0, end: 20, hidden: 0, canReveal: false });
  });

  test('mounts only the tail of a long payload', () => {
    const window = outputWindow(1000, OUTPUT_WINDOW_INITIAL);
    expect(window).toEqual({ start: 1000 - OUTPUT_WINDOW_INITIAL, end: 1000, hidden: 1000 - OUTPUT_WINDOW_INITIAL, canReveal: true });
  });

  test('never mounts past the ceiling, however high the counter climbs', () => {
    const window = outputWindow(5000, 999_999);
    expect(window.end - window.start).toBe(OUTPUT_WINDOW_MAX);
  });

  test('treats a zero-line payload as empty rather than as everything', () => {
    expect(outputWindow(0, OUTPUT_WINDOW_INITIAL)).toEqual({ start: 0, end: 0, hidden: 0, canReveal: false });
  });

  test('clamps a counter below the initial window', () => {
    const window = outputWindow(1000, 1);
    expect(window.end - window.start).toBe(OUTPUT_WINDOW_INITIAL);
  });
});

describe('revealMore', () => {
  test('adds one step', () => {
    expect(revealMore(OUTPUT_WINDOW_INITIAL, 5000)).toBe(OUTPUT_WINDOW_INITIAL + OUTPUT_WINDOW_STEP);
  });

  test('stops at the payload size when that is below the ceiling', () => {
    expect(revealMore(OUTPUT_WINDOW_INITIAL, 200)).toBe(200);
  });

  test('is a fixed point at the ceiling, so a caller can hide its control', () => {
    const atCeiling = revealMore(OUTPUT_WINDOW_MAX, 5000);
    expect(atCeiling).toBe(OUTPUT_WINDOW_MAX);
    expect(revealMore(atCeiling, 5000)).toBe(atCeiling);
    expect(canRevealMore(atCeiling, 5000)).toBe(false);
  });

  test('reports that more is available below the ceiling', () => {
    expect(canRevealMore(OUTPUT_WINDOW_INITIAL, 5000)).toBe(true);
  });
});
