/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, test } from 'bun:test';
import {
  TERMINAL_SCROLLBACK_BYTES,
  TERMINAL_SCROLLBACK_LINES,
  scrollbackBytesForLines,
} from '@/client/data/theme/terminal';

describe('terminal scrollback budget', () => {
  test('is a byte budget, not xterm’s line count', () => {
    // Ghostty charges roughly one 16-byte cell per retained column.
    expect(scrollbackBytesForLines(10_000, 100)).toBe(16_000_000);
    expect(TERMINAL_SCROLLBACK_BYTES).toBe(scrollbackBytesForLines(TERMINAL_SCROLLBACK_LINES, 100));
    // Passing xterm's `10000` through as the option would be ~1000× too small.
    expect(TERMINAL_SCROLLBACK_BYTES).toBeGreaterThan(10_000);
  });

  test('never returns a zero budget', () => {
    expect(scrollbackBytesForLines(0, 0)).toBe(16);
  });
});
