/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * omp's excerpt diff is not a unified diff, and a unified-diff renderer paints
 * its `-43|` gutter as code — measured in the browser, the number survived into
 * the code cell and the header named a path called `diff`.
 *
 * These pin the conversion in both directions: the gutter is stripped, the
 * numbers come back as `oldLine`/`newLine`, and the classification refuses to
 * mistake a real unified diff (or a git-format one) for an excerpt.
 */

import { describe, expect, test } from 'bun:test';
import {
  excerptDiffStats,
  excerptDiffToUnified,
  isExcerptDiff,
  parseExcerptDiff,
} from '@/shared/lib/fs/excerpt-diff';

/** Verbatim from a real `edit` toolResult (`details.diff`). */
const EXCERPT = [
  ' 41|',
  ' 42|function readEntryFile(entry: FileSystemFileEntry): Promise<File | null> {',
  '-43|  return new Promise((resolve) => entry.file(resolve, () => resolve(null)));',
  '+43|  const { promise, resolve } = Promise.withResolvers<File | null>();',
  '+44|  entry.file(resolve, () => resolve(null));',
  ' 45|}',
].join('\n');

const UNIFIED = [
  'diff --git a/x.ts b/x.ts',
  'index 111..222 100644',
  '--- a/x.ts',
  '+++ b/x.ts',
  '@@ -41,3 +41,4 @@',
  ' context',
  '-old',
  '+new',
].join('\n');

describe('isExcerptDiff', () => {
  test('recognizes omp excerpt rows', () => {
    expect(isExcerptDiff(EXCERPT)).toBe(true);
  });

  test('refuses a git unified diff', () => {
    expect(isExcerptDiff(UNIFIED)).toBe(false);
  });

  test('refuses a headerless unified diff', () => {
    expect(isExcerptDiff('@@ -1,2 +1,2 @@\n-a\n+b')).toBe(false);
  });

  test('refuses free text with no gutter', () => {
    expect(isExcerptDiff('Applied 3 replacements\nDone.')).toBe(false);
  });

  test('refuses an empty payload', () => {
    expect(isExcerptDiff('')).toBe(false);
  });
});

describe('parseExcerptDiff', () => {
  test('strips the gutter and classifies each row', () => {
    const rows = parseExcerptDiff(EXCERPT);
    expect(rows.map((row) => row.type)).toEqual(['context', 'context', 'del', 'add', 'add', 'context']);
    // The bug: the gutter used to stay welded to the code.
    expect(rows[2].text).toBe('  return new Promise((resolve) => entry.file(resolve, () => resolve(null)));');
    expect(rows[3].text).toBe('  const { promise, resolve } = Promise.withResolvers<File | null>();');
  });

  test('recovers the file line numbers the gutter carried', () => {
    const rows = parseExcerptDiff(EXCERPT);
    expect(rows[2]).toMatchObject({ type: 'del', oldLine: 43 });
    expect(rows[3]).toMatchObject({ type: 'add', newLine: 43 });
    expect(rows[5]).toMatchObject({ type: 'context', oldLine: 45, newLine: 45 });
  });

  test('keeps a bare blank-line row as an empty context row', () => {
    const rows = parseExcerptDiff(' 12|');
    expect(rows).toEqual([{ type: 'context', text: '', oldLine: 12, newLine: 12 }]);
  });

  test('keeps an elision marker as meta rather than dropping it', () => {
    const rows = parseExcerptDiff([' 1|a', '…', ' 9|b'].join('\n'));
    expect(rows.map((row) => row.type)).toEqual(['context', 'meta', 'context']);
    expect(rows[1].text).toBe('…');
  });

  test('never drops an unparsable line', () => {
    const rows = parseExcerptDiff([' 1|a', 'Could not find a close enough match', ' 2|b'].join('\n'));
    expect(rows).toHaveLength(3);
    expect(rows[1]).toMatchObject({ type: 'meta', text: 'Could not find a close enough match' });
  });
});

describe('excerptDiffToUnified', () => {
  test('emits a hunk header whose counts match the rows', () => {
    const unified = excerptDiffToUnified(EXCERPT);
    const [header] = unified.split('\n');
    // 4 rows exist in the old file (3 context + 1 del), 5 in the new.
    expect(header).toBe('@@ -41,4 +41,5 @@');
  });

  test('emits standard markers a unified renderer can read', () => {
    const body = excerptDiffToUnified(EXCERPT).split('\n').slice(1);
    expect(body).toContain('-  return new Promise((resolve) => entry.file(resolve, () => resolve(null)));');
    expect(body).toContain('+  const { promise, resolve } = Promise.withResolvers<File | null>();');
    // No gutter survives anywhere.
    expect(excerptDiffToUnified(EXCERPT)).not.toContain('43|');
  });

  test('falls back to the input when there is nothing to convert', () => {
    expect(excerptDiffToUnified('')).toBe('');
  });
});

describe('excerptDiffStats', () => {
  test('counts added and removed rows', () => {
    expect(excerptDiffStats(EXCERPT)).toEqual({ added: 2, removed: 1 });
  });

  test('counts nothing for context-only input', () => {
    expect(excerptDiffStats(' 1|a\n 2|b')).toEqual({ added: 0, removed: 0 });
  });
});
