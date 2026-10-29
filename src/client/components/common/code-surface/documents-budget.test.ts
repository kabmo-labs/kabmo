/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The budget behind `documents-budget.ts`: two limits, one eviction order, and
 * the two properties a wrong answer would show as a lost undo history.
 */

import { describe, expect, test } from 'bun:test';
import {
  MAX_CACHED_CHARS,
  MAX_CACHED_DOCUMENTS,
  documentsToEvict,
} from '@/client/components/common/code-surface/documents-budget';

const KB = 1024;

function evict(keys: string[], sizes: Record<string, number>, keep: string): string[] {
  return documentsToEvict(keys, (key) => sizes[key] ?? 0, keep);
}

describe('documentsToEvict', () => {
  test('nothing is dropped while both budgets hold', () => {
    const keys = ['a', 'b', 'c'];
    expect(evict(keys, { a: KB, b: KB, c: KB }, 'c')).toEqual([]);
  });

  test('past the tab count, the least recently used are dropped', () => {
    const keys = Array.from({ length: MAX_CACHED_DOCUMENTS + 3 }, (_, i) => `d${i}`);
    const sizes = Object.fromEntries(keys.map((key) => [key, 10]));
    expect(evict(keys, sizes, keys[keys.length - 1])).toEqual(['d0', 'd1', 'd2']);
  });

  test('past the byte budget, documents are dropped even under the tab count', () => {
    // Three documents of 4 MiB each: the count is 3, the bytes are 12 MiB.
    const keys = ['a', 'b', 'c'];
    const sizes = { a: 4 * 1024 * KB, b: 4 * 1024 * KB, c: 4 * 1024 * KB };
    expect(MAX_CACHED_CHARS).toBe(8 * 1024 * KB);
    expect(evict(keys, sizes, 'c')).toEqual(['a']);
  });

  test('the document being opened is never evicted, even alone over budget', () => {
    const keys = ['a', 'b'];
    const sizes = { a: 20 * 1024 * KB, b: 20 * 1024 * KB };
    expect(evict(keys, sizes, 'b')).toEqual(['a']);
    expect(evict(['a'], { a: 20 * 1024 * KB }, 'a')).toEqual([]);
  });

  test('the last document is never dropped, whatever its size', () => {
    expect(evict(['only'], { only: 100 * 1024 * KB }, 'other')).toEqual([]);
  });
});
