/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Replacement expansion: what one match becomes, and how a template is read.
 *
 * Each rule is asserted against the engine's own `String.replace` where one
 * exists, because the search panel's replace PREVIEW and the write that lands
 * must agree — a preview that painted `$1` over a file that would receive the
 * captured group is exactly the drift this covers.
 */

import { describe, expect, test } from 'bun:test';

import {
  expandReplacement,
  replaceAllMatches,
  replaceMatch,
} from '@/shared/lib/code/editor/find-replace';
import type { FindOptions } from '@/shared/lib/code/editor/find-scan';
import { findMatches } from '@/shared/lib/code/editor/find-scan';

const PLAIN: FindOptions = { matchCase: false, wholeWord: false, isRegex: false };

describe('replaceMatch', () => {
  test('literal replacement inserts the field verbatim, dollar signs included', () => {
    const text = 'const a = 1;';
    const result = replaceMatch(text, { start: 6, end: 7 }, 'a', '$&x', PLAIN);
    expect(result?.text).toBe('const $&x = 1;');
    expect(result?.caret).toBe(6 + 3);
  });

  test('regex replacement expands capture groups like String.replace', () => {
    const text = 'key = value';
    const result = replaceMatch(text, { start: 6, end: 11 }, '(\\w+)', '[$1]', { ...PLAIN, isRegex: true });
    expect(result?.text).toBe('key = [value]');
    expect(result?.caret).toBe(13);
  });

  test('refuses a match that is no longer at its offset', () => {
    expect(replaceMatch('abc', { start: 5, end: 7 }, 'a', 'z', PLAIN)).toBeNull();
  });
});

describe('replaceAllMatches', () => {
  test('literal replace-all rewrites every occurrence', () => {
    expect(replaceAllMatches('a a a', 'a', 'b', PLAIN)).toBe('b b b');
  });

  test('regex replace-all agrees with the engine', () => {
    const text = 'foo1 bar2';
    const options: FindOptions = { ...PLAIN, isRegex: true };
    expect(replaceAllMatches(text, '([a-z]+)(\\d)', '$2-$1', options)).toBe(text.replace(/([a-z]+)(\d)/g, '$2-$1'));
  });

  test('whole-word replace-all leaves substrings alone', () => {
    expect(replaceAllMatches('cat category', 'cat', 'dog', { ...PLAIN, wholeWord: true })).toBe('dog category');
  });

  test('returns null for an unusable query', () => {
    expect(replaceAllMatches('abc', '(', 'x', { ...PLAIN, isRegex: true })).toBeNull();
    expect(replaceAllMatches('abc', '', 'x', PLAIN)).toBeNull();
  });
});

/**
 * The write path and the match list must be the SAME answer.
 *
 * They were not, and every case below was silent: the scan runs through
 * CodeMirror's `RegExpCursor` (`gm` + `u`) while the replacement compiled the
 * query itself (`g`/`gi`), so the count in the widget and the bytes written
 * disagreed about anchors, unicode property escapes and which escapes are even
 * legal. `find-scan.ts` now states the flags once (`BASE_FLAGS`), and these
 * assert the two ends together rather than one engine in isolation.
 */
describe('the write path agrees with the scan', () => {
  const REGEX: FindOptions = { ...PLAIN, isRegex: true };

  test('an anchored pattern rewrites every line the scan counted', () => {
    const text = 'foo\nbar\nfoo';
    expect(findMatches(text, '^foo', REGEX).matches).toHaveLength(2);
    expect(replaceAllMatches(text, '^foo', 'X', REGEX)).toBe('X\nbar\nX');

    expect(findMatches(text, 'foo$', REGEX).matches).toHaveLength(2);
    expect(replaceAllMatches(text, 'foo$', 'X', REGEX)).toBe('X\nbar\nX');
  });

  test('a unicode property escape finds AND replaces', () => {
    const text = 'a1 b2';
    expect(findMatches(text, '\\p{L}\\d', REGEX).matches).toHaveLength(2);
    expect(replaceAllMatches(text, '\\p{L}\\d', 'X', REGEX)).toBe('X X');
    expect(replaceMatch(text, { start: 0, end: 2 }, '\\p{L}\\d', 'X', REGEX)?.text).toBe('X b2');
  });

  test('an escape the scan calls invalid is refused by the write too', () => {
    // `\-` is a legal identity escape without `u` and a syntax error with it.
    expect(findMatches('a-b', '\\-', REGEX).invalid).toBe(true);
    expect(replaceAllMatches('a-b', '\\-', 'X', REGEX)).toBeNull();
  });

  test('a zero-width match is replaced by nothing, exactly as it is uncounted', () => {
    // The widget says "No results" for `^`; inserting at every line start under
    // it was the write contradicting the count it was shown beside.
    expect(findMatches('a\nb', '^', REGEX).matches).toEqual([]);
    expect(replaceAllMatches('a\nb', '^', 'X', REGEX)).toBe('a\nb');
    expect(replaceAllMatches('abc', 'x*', 'X', REGEX)).toBe('abc');
  });
});

describe('expandReplacement', () => {
  /** Indexed by group number, `[0]` unused — the shape `groupsOf` produces. */
  const groups = { full: 'ab12', numbered: [undefined, 'a', 'b'] as const, named: { tail: '12' } };

  test('expands $&, $1 and $<name>', () => {
    expect(expandReplacement('$&|$1|$2|$<tail>', groups)).toBe('ab12|a|b|12');
  });

  test('$$ is a literal dollar and an unknown group is empty', () => {
    expect(expandReplacement('$$$9', groups)).toBe('$');
  });

  test('a missing two-digit group falls back to the one-digit group plus the digit', () => {
    // The engine's own reading of `$12` with two groups: `$1` then a literal `2`.
    expect('x'.replace(/(x)/, '$12')).toBe('x2');
    expect(expandReplacement('$12', groups)).toBe('a2');
  });

  test('a template without a dollar is returned as-is', () => {
    expect(expandReplacement('plain', groups)).toBe('plain');
  });
});

