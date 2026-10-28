/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The outline's two bounds.
 *
 * Both exist because a large file's outline is not a long list, it is a DOM:
 * measured on a 10 MB source with 63 618 declarations, the panel mounted
 * 446 308 nodes and a keystroke cost 953 ms (against the editor's own 34 ms).
 * These cases pin the arithmetic that keeps that from happening, and the
 * sentences that stop a truncated list from reading as a complete one.
 */

import { describe, expect, test } from 'bun:test';
import {
  MAX_OUTLINE_ROWS,
  MAX_OUTLINE_SCAN_CHARS,
  outlineTooLargeNotice,
  outlineTruncatedNotice,
  outlineWindow,
} from '@/shared/lib/code/outline/rows';
import type { OutlineSymbol } from '@/shared/lib/code/outline/types';

function symbols(count: number): OutlineSymbol[] {
  return Array.from({ length: count }, (_, i) => ({
    name: `fn${i}`,
    kind: 'function' as const,
    line: i + 1,
    column: 0,
    depth: 0,
  }));
}

describe('outlineWindow', () => {
  test('a list under the cap is returned whole, in source order', () => {
    const all = symbols(5);
    const window = outlineWindow(all);

    expect(window.rows).toEqual(all);
    expect(window.total).toBe(5);
    expect(window.truncated).toBe(false);
  });

  test('exactly the cap is not truncated', () => {
    const window = outlineWindow(symbols(MAX_OUTLINE_ROWS));

    expect(window.rows).toHaveLength(MAX_OUTLINE_ROWS);
    expect(window.truncated).toBe(false);
  });

  test('past the cap the list is the FIRST rows, and it says how many there are', () => {
    const window = outlineWindow(symbols(MAX_OUTLINE_ROWS + 120));

    expect(window.rows).toHaveLength(MAX_OUTLINE_ROWS);
    expect(window.total).toBe(MAX_OUTLINE_ROWS + 120);
    expect(window.truncated).toBe(true);
    // Source order, not a sample: the outline is a map of the document, so the
    // top of the file is what a window shows.
    expect(window.rows[0].name).toBe('fn0');
    expect(window.rows[MAX_OUTLINE_ROWS - 1].name).toBe(`fn${MAX_OUTLINE_ROWS - 1}`);
  });

  test('an empty list is not truncated', () => {
    const window = outlineWindow([]);

    expect(window.rows).toEqual([]);
    expect(window.total).toBe(0);
    expect(window.truncated).toBe(false);
  });
});

describe('outlineTooLargeNotice', () => {
  test('a buffer at the scan ceiling is still outlined', () => {
    expect(outlineTooLargeNotice(MAX_OUTLINE_SCAN_CHARS)).toBeNull();
    expect(outlineTooLargeNotice(1024)).toBeNull();
  });

  test('past it the sentence names the size, so the empty panel is explained', () => {
    const notice = outlineTooLargeNotice(MAX_OUTLINE_SCAN_CHARS + 1);

    expect(notice).not.toBeNull();
    expect(notice).toContain('8.0 MB');
    expect(notice).toContain('too large to outline');
  });
});

describe('outlineTruncatedNotice', () => {
  test('it names both the shown count and the total, thousands separated', () => {
    const notice = outlineTruncatedNotice(63618);

    expect(notice).toContain('500');
    expect(notice).toContain('63,618');
  });
});
