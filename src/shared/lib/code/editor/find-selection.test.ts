/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * "In selection" and the query history.
 *
 * The range is applied INSIDE the scan rather than by slicing the text, which is the
 * whole point: every consumer (the widget's count, the painted marks, replace-one,
 * replace-all) works in DOCUMENT offsets. A slice would hand them a second coordinate
 * system and replace would write at the wrong place.
 */

import { describe, expect, test } from 'bun:test';

import { findMatches, type FindOptions } from '@/shared/lib/code/editor/find-scan';

const BASE: FindOptions = { matchCase: false, wholeWord: false, isRegex: false, inSelection: false };

describe('findMatches with a range', () => {
  const text = 'alpha beta alpha gamma alpha';

  test('without the flag the range is ignored, so a caller cannot restrict by accident', () => {
    const all = findMatches(text, 'alpha', BASE, { start: 0, end: 10 });
    expect(all.matches).toHaveLength(3);
  });

  test('with the flag only matches fully inside the range survive', () => {
    const inSelection = findMatches(text, 'alpha', { ...BASE, inSelection: true }, { start: 0, end: 10 });
    expect(inSelection.matches).toEqual([{ start: 0, end: 5 }]);
  });

  test('the offsets are DOCUMENT offsets, not offsets within the range', () => {
    // The second `alpha` starts at 11; a slice would have reported 1.
    const result = findMatches(text, 'alpha', { ...BASE, inSelection: true }, { start: 11, end: 22 });
    expect(result.matches).toEqual([{ start: 11, end: 16 }]);
  });

  test('a match that STRADDLES the boundary is excluded — it is not wholly in the selection', () => {
    const result = findMatches(text, 'alpha', { ...BASE, inSelection: true }, { start: 3, end: 20 });
    expect(result.matches).toEqual([{ start: 11, end: 16 }]);
  });

  test('a null range with the flag set behaves like no restriction', () => {
    // The widget disarms the flag when nothing is selected, so this is the defensive
    // branch rather than the normal path.
    const result = findMatches(text, 'alpha', { ...BASE, inSelection: true }, null);
    expect(result.matches).toHaveLength(3);
  });

  test('an empty range finds nothing, rather than everything', () => {
    const result = findMatches(text, 'alpha', { ...BASE, inSelection: true }, { start: 4, end: 4 });
    expect(result.matches).toEqual([]);
  });
});
