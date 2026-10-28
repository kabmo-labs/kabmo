/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The find widget's readouts.
 *
 * These are the two messages the widget exists to keep apart: "No results" and
 * "your pattern does not compile" are different answers, and a match list that
 * stopped at the cap has to say so rather than report a total it never counted.
 */

import { describe, expect, test } from 'bun:test';

import { findCounterLabel, findStatusLabel } from '@/shared/lib/code/editor/find-status';

describe('findCounterLabel', () => {
  test('counts from one, the way a reader does', () => {
    expect(findCounterLabel({ total: 7, current: 2, truncated: false })).toBe('3 of 7');
  });

  test('a capped list is reported with a plus, never as a total', () => {
    // The scan stopped at the cap; printing "1 of 5000" would claim the
    // document holds exactly 5000 matches.
    expect(findCounterLabel({ total: 5000, current: 0, truncated: true })).toBe('1 of 5000+');
  });

  test('says nothing when there is nothing to count', () => {
    expect(findCounterLabel({ total: 0, current: -1, truncated: false })).toBe('');
  });
});

describe('findStatusLabel', () => {
  test('names an uncompilable pattern as such', () => {
    expect(findStatusLabel('a(', true, { total: 0, current: -1, truncated: false })).toBe('Invalid pattern');
  });

  test('a query with no matches says so', () => {
    expect(findStatusLabel('zzz', false, { total: 0, current: -1, truncated: false })).toBe('No results');
  });

  test('an empty query says nothing — an untouched field is not a failed search', () => {
    expect(findStatusLabel('', false, { total: 0, current: -1, truncated: false })).toBe('');
  });

  test('otherwise it is the counter', () => {
    expect(findStatusLabel('alpha', false, { total: 5, current: 0, truncated: false })).toBe('1 of 5');
  });
});
