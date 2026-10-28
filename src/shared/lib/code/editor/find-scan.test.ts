/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The find widget's scan: what a query matches and how the caret anchors to it.
 *
 * The scan runs on CodeMirror's `RegExpCursor`, so these cases are the CONTRACT
 * that cursor has to keep — the same ordered list, the same case/whole-word/regex
 * options, a broken pattern reported as `invalid` rather than as "no matches",
 * and the cap. They are asserted here rather than through a live editor because
 * the widget, the count and the painted marks all read this one function.
 */

import { describe, expect, test } from 'bun:test';

import {
  buildFindRegex,
  findMatches,
  lineIndexAt,
  lineStartOffset,
  matchIndexAtOrAfter,
  MAX_FIND_MATCHES,
  stepMatchIndex,
  type FindOptions,
} from '@/shared/lib/code/editor/find-scan';

const PLAIN: FindOptions = { matchCase: false, wholeWord: false, isRegex: false, inSelection: false };

describe('findMatches', () => {
  test('finds literal occurrences in document order, ignoring case by default', () => {
    const text = 'Alpha beta ALPHA alpha';
    expect(findMatches(text, 'alpha', PLAIN).matches).toEqual([
      { start: 0, end: 5 },
      { start: 11, end: 16 },
      { start: 17, end: 22 },
    ]);
  });

  test('matchCase narrows to the exact spelling', () => {
    expect(findMatches('Alpha alpha', 'alpha', { ...PLAIN, matchCase: true }).matches).toEqual([
      { start: 6, end: 11 },
    ]);
  });

  test('wholeWord rejects a match inside a longer word', () => {
    const text = 'cat category cat';
    expect(findMatches(text, 'cat', { ...PLAIN, wholeWord: true }).matches).toEqual([
      { start: 0, end: 3 },
      { start: 13, end: 16 },
    ]);
  });

  test('wholeWord keeps an alternation’s own precedence', () => {
    // `\bfoo|bar\b` would match `bar` inside `barbaz`; the group prevents it.
    expect(findMatches('barbaz bar', 'foo|bar', { ...PLAIN, wholeWord: true, isRegex: true }).matches).toEqual([
      { start: 7, end: 10 },
    ]);
  });

  test('regex mode compiles the query as written', () => {
    expect(findMatches('a1 b2 c3', '[a-z]\\d', { ...PLAIN, isRegex: true }).matches).toEqual([
      { start: 0, end: 2 },
      { start: 3, end: 5 },
      { start: 6, end: 8 },
    ]);
  });

  test('an uncompilable regex is reported as invalid, not as no matches', () => {
    const result = findMatches('abc', '(', { ...PLAIN, isRegex: true });
    expect(result).toEqual({ matches: [], truncated: false, invalid: true });
  });

  test('an empty query matches nothing and is not an error', () => {
    expect(findMatches('abc', '', PLAIN)).toEqual({ matches: [], truncated: false, invalid: false });
  });

  test('skips zero-width matches instead of looping forever', () => {
    const result = findMatches('abc', 'x*', { ...PLAIN, isRegex: true });
    expect(result.matches).toEqual([]);
    expect(result.invalid).toBe(false);
  });

  test('finds a match that begins at a line start, and one that spans lines', () => {
    // The cursor searches line by line, so both edges are where it can lose a
    // match: a pattern anchored at a line start, and one whose `\n` forces the
    // whole-document path.
    expect(findMatches('one\ntwo\ntwo', 'two', PLAIN).matches).toEqual([
      { start: 4, end: 7 },
      { start: 8, end: 11 },
    ]);
    expect(findMatches('one\ntwo', 'one\ntwo', { ...PLAIN, isRegex: true }).matches).toEqual([{ start: 0, end: 7 }]);
  });

  test('caps the collected matches and says so', () => {
    const text = 'a'.repeat(MAX_FIND_MATCHES + 10);
    const result = findMatches(text, 'a', PLAIN);
    expect(result.matches).toHaveLength(MAX_FIND_MATCHES);
    expect(result.truncated).toBe(true);
  });
});

describe('buildFindRegex', () => {
  test('escapes a literal query so regex metacharacters are literal', () => {
    const regex = buildFindRegex('a.c', PLAIN);
    expect(regex?.test('a.c')).toBe(true);
    expect(regex?.test('abc')).toBe(false);
  });

  test('returns null for an empty query and for a bad pattern', () => {
    expect(buildFindRegex('', PLAIN)).toBeNull();
    expect(buildFindRegex('[', { ...PLAIN, isRegex: true })).toBeNull();
  });
});

describe('caret anchoring', () => {
  test('lineIndexAt and lineStartOffset are inverses for every line start', () => {
    const text = 'one\ntwo\n\nfour';
    // Line starts in `text`: 0, 4, 8 (the empty line) and 9.
    for (const offset of [0, 4, 8, 9]) {
      const line = lineIndexAt(text, offset);
      expect(lineStartOffset(text, line)).toBe(offset);
    }
    expect(lineIndexAt(text, 13)).toBe(3);
  });

  test('lineIndexAt clamps an offset past the end to the last line', () => {
    expect(lineIndexAt('one\ntwo', 999)).toBe(1);
  });

  test('a caret inside a match selects that match, and past the last wraps to the first', () => {
    const matches = [
      { start: 0, end: 3 },
      { start: 10, end: 13 },
    ];
    expect(matchIndexAtOrAfter(matches, 1)).toBe(0);
    expect(matchIndexAtOrAfter(matches, 3)).toBe(1);
    expect(matchIndexAtOrAfter(matches, 13)).toBe(0);
    expect(matchIndexAtOrAfter([], 0)).toBe(-1);
  });

  test('stepping wraps at both ends', () => {
    expect(stepMatchIndex(2, 3, 1)).toBe(0);
    expect(stepMatchIndex(0, 3, -1)).toBe(2);
    expect(stepMatchIndex(-1, 3, -1)).toBe(2);
    expect(stepMatchIndex(0, 0, 1)).toBe(-1);
  });
});
