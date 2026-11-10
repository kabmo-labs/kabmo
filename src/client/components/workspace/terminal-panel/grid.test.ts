/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, test } from 'bun:test';
import {
  GRID_SETTLE_MS,
  MIN_REPORT_COLS,
  MIN_REPORT_ROWS,
  gridDecision,
} from '@/client/components/workspace/terminal-panel/grid';

const UNATTACHED = { attached: false, committed: { cols: 0, rows: 0 } };

describe('gridDecision', () => {
  test('announces the first real grid as the attach size', () => {
    expect(gridDecision({ cols: 41, rows: 47, ...UNATTACHED })).toEqual({
      kind: 'attach',
      cols: 41,
      rows: 47,
    });
  });

  test('ignores a squeezed panel instead of resizing the shell', () => {
    // Measured: `resize 5x37` reached a real shell while the panel was opening
    // its width transition, and the shell redrew its prompt hard-wrapped.
    expect(gridDecision({ cols: 5, rows: 37, ...UNATTACHED })).toEqual({ kind: 'ignore' });
    expect(gridDecision({ cols: MIN_REPORT_COLS - 1, rows: 47, ...UNATTACHED })).toEqual({
      kind: 'ignore',
    });
    expect(gridDecision({ cols: 41, rows: MIN_REPORT_ROWS - 1, ...UNATTACHED })).toEqual({
      kind: 'ignore',
    });
  });

  test('maps a corrected grid onto a resize once attached', () => {
    const attached = { attached: true, committed: { cols: 41, rows: 47 } };
    expect(gridDecision({ cols: 41, rows: 47, ...attached })).toEqual({ kind: 'ignore' });
    expect(gridDecision({ cols: 40, rows: 47, ...attached })).toEqual({
      kind: 'change',
      cols: 40,
      rows: 47,
    });
  });

  test('waits longer than a frame before announcing', () => {
    // The panel's width transition outlives one animation frame; a gate shorter
    // than ~100 ms measured the animating box again.
    expect(GRID_SETTLE_MS).toBeGreaterThanOrEqual(100);
  });
});
