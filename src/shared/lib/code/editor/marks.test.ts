/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Find marks spliced into the highlighter's token markup.
 *
 * The cases that matter are the ones a naive implementation gets wrong: a match
 * that spans several tokens (`const alpha` is three), a token that holds two
 * matches, and text that has to be escaped on the way in. Every assertion is on
 * the TEXT of the marks, because a match broken across tokens is several
 * fragments by construction.
 */

import { describe, expect, test } from 'bun:test';

import { tokenMarkup, MARK_CURRENT_OPEN, MARK_OPEN } from '@/shared/lib/code/editor/marks';

/** The text of every mark in `html`, in order. */
function marked(html: string): string[] {
  return Array.from(html.matchAll(/<mark class="find-match"[^>]*>(.*?)<\/mark>/g), (match) => match[1]);
}

describe('tokenMarkup', () => {
  test('returns escaped content unchanged when there are no marks', () => {
    expect(tokenMarkup('a < b', 0, undefined, -1)).toBe('a &lt; b');
    expect(tokenMarkup('a < b', 0, [], -1)).toBe('a &lt; b');
  });

  test('wraps the part of the token the match covers', () => {
    expect(tokenMarkup('alpha', 0, [{ start: 0, end: 5 }], 0)).toBe(`${MARK_CURRENT_OPEN}alpha</mark>`);
  });

  test('splits a token that holds two matches', () => {
    const html = tokenMarkup('a a', 0, [{ start: 0, end: 1 }, { start: 2, end: 3 }], -1);

    expect(marked(html)).toEqual(['a', 'a']);
    expect(html.match(/<mark/g)?.length).toBe(2);
  });

  test('clips a match that starts before the token', () => {
    // `const alpha` spans three tokens; the fragment inside `alpha` is the tail
    // of one match, and the markup must not repeat the part already emitted.
    const html = tokenMarkup('alpha', 6, [{ start: 0, end: 11 }], 0);

    expect(marked(html)).toEqual(['alpha']);
  });

  test('clips a match that runs past the token', () => {
    const html = tokenMarkup('const', 0, [{ start: 0, end: 11 }], -1);

    expect(marked(html)).toEqual(['const']);
  });

  test('escapes the matched text it wraps', () => {
    expect(tokenMarkup('<', 0, [{ start: 0, end: 1 }], -1)).toContain('&lt;');
  });

  test('the current match is painted differently from the others', () => {
    // The caret is aimed at exactly one match, so the reader has to be able to
    // see which — and the others must not claim that mark.
    expect(tokenMarkup('a', 0, [{ start: 0, end: 1 }], 0)).toContain('data-find-current');
    expect(tokenMarkup('a', 0, [{ start: 0, end: 1 }], -1)).not.toContain('data-find-current');
  });

  test('a plain match is neither current nor an occurrence', () => {
    const html = tokenMarkup('a', 0, [{ start: 0, end: 1 }], -1);

    expect(html).toContain(MARK_OPEN);
    expect(html).not.toContain('data-');
  });

  test('marks are read in document order, so a match before the token is skipped', () => {
    // The loop stops at the first mark that begins after the token: anything
    // earlier cannot intersect it.
    const html = tokenMarkup('beta', 6, [{ start: 0, end: 5 }, { start: 6, end: 10 }], -1);

    expect(marked(html)).toEqual(['beta']);
  });

  test('a zero-width mark paints nothing', () => {
    expect(marked(tokenMarkup('alpha', 0, [{ start: 2, end: 2 }], -1))).toEqual([]);
  });
});
