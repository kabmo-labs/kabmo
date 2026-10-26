/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The write-conflict rules, as a pure function plus its request parser.
 *
 * Three branches that all look alike in a handler, and each is a different
 * decision:
 *
 * - no base → no expectation (a handle-backed file, an older client);
 * - the file is gone → not a conflict (recreating it is `confirmSaveMissing`'s
 *   decision, already made by the caller);
 * - the mtime moved → a conflict, carrying the CURRENT value so the client can
 *   offer Reload/Keep instead of reporting a failure.
 */

import { describe, expect, test } from 'bun:test';

import { checkWriteConflict, parseBaseMtime } from '@/server/lib/fs/write-conflict';

/** A stat that answers `mtimeMs` for one path, or null when it is gone. */
function statOf(mtimeMs: number | null) {
  return async () => (mtimeMs === null ? null : { mtimeMs });
}

describe('checkWriteConflict', () => {
  test('no base means no expectation — the write proceeds', async () => {
    expect(await checkWriteConflict('/a.ts', undefined, statOf(5))).toEqual({ write: true, diskMtimeMs: null });
    expect(await checkWriteConflict('/a.ts', null, statOf(5))).toEqual({ write: true, diskMtimeMs: null });
  });

  test('a matching mtime writes', async () => {
    expect(await checkWriteConflict('/a.ts', 5, statOf(5))).toEqual({ write: true, diskMtimeMs: 5 });
  });

  test('a moved mtime is a conflict, and the verdict carries what is there now', async () => {
    expect(await checkWriteConflict('/a.ts', 5, statOf(9))).toEqual({ write: false, diskMtimeMs: 9 });
  });

  test('a file that is gone is not a conflict — recreating it is the caller’s decision', async () => {
    expect(await checkWriteConflict('/a.ts', 5, statOf(null))).toEqual({ write: true, diskMtimeMs: null });
  });

  test('the comparison is exact: a one-millisecond move is a conflict', async () => {
    expect(await checkWriteConflict('/a.ts', 5, statOf(6))).toEqual({ write: false, diskMtimeMs: 6 });
  });
});

describe('parseBaseMtime', () => {
  test('a numeric field parses', () => {
    expect(parseBaseMtime('1700000000123')).toBe(1_700_000_000_123);
  });

  test('an absent, empty or malformed field is "no expectation", never a refusal', () => {
    // Refusing a legitimate save over a parsing detail is the failure this
    // tolerance exists to prevent.
    expect(parseBaseMtime(null)).toBeUndefined();
    expect(parseBaseMtime('')).toBeUndefined();
    expect(parseBaseMtime('abc')).toBeUndefined();
    expect(parseBaseMtime('NaN')).toBeUndefined();
  });

  test('a File entry is not a mtime', () => {
    expect(parseBaseMtime(new File(['x'], 'a.txt'))).toBeUndefined();
  });
});
