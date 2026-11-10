/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, test } from 'bun:test';
import { gridForContainer } from '@/client/components/workspace/terminal-panel/fit';

// The measured cell box at 12 px Fira Code.
const CELL = { width: 8, height: 16 };

describe('gridForContainer', () => {
  test('divides the whole panel, with no scrollbar reservation', () => {
    // 334 × 759 is the host measured in the right panel at 1440 × 900.
    // ghostty-web's own proposal subtracts 15 px first and would answer 39;
    // that shortfall is what read as a terminal that was not full width.
    expect(gridForContainer(334, 759, CELL)).toEqual({ cols: 41, rows: 47 });
  });

  test('drops the sub-cell remainder instead of overflowing the box', () => {
    // One pixel short of a column still fits 41; the extra 7 px of a 335 box
    // must not become a 42nd cell that hangs outside the panel.
    expect(gridForContainer(335, 767, CELL)).toEqual({ cols: 41, rows: 47 });
    expect(gridForContainer(333, 758, CELL)).toEqual({ cols: 41, rows: 47 });
  });

  test('keeps a usable grid for a box smaller than a cell', () => {
    // A hidden panel measures 0 while the view stays mounted; the caller guards
    // that, and this floor is the last line of defence against 0 × 0.
    expect(gridForContainer(0, 0, CELL)).toEqual({ cols: 2, rows: 1 });
  });

  test('refuses to divide by an unmeasured cell', () => {
    expect(gridForContainer(320, 640, { width: 0, height: 16 })).toBeNull();
    expect(gridForContainer(320, 640, { width: 8, height: 0 })).toBeNull();
  });
});
