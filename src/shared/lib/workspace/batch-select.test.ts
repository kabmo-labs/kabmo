/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The batch-selection rules, in isolation.
 *
 * Each of these decides what a header checkbox reports or what a Delete sends,
 * so the failure mode is a delete of the wrong rows — not a cosmetic bug. The
 * archived rule is the one that matters most: a row the filter hides cannot be
 * unselected, so "select all" must never reach it.
 */

import { describe, expect, test } from 'bun:test';
import {
  liveSelection,
  selectableSessionIds,
  selectionSummary,
  toggleSelection,
} from '@/shared/lib/workspace/batch-select';

describe('toggleSelection', () => {
  test('adds an id it does not hold, preserving click order', () => {
    expect(toggleSelection(['a'], 'b')).toEqual(['a', 'b']);
  });

  test('removes an id it holds', () => {
    expect(toggleSelection(['a', 'b', 'c'], 'b')).toEqual(['a', 'c']);
  });

  test('does not mutate the input', () => {
    const selected = ['a'];
    toggleSelection(selected, 'b');
    expect(selected).toEqual(['a']);
  });
});

describe('selectionSummary', () => {
  test('reports all only when every available id is selected', () => {
    expect(selectionSummary(['a', 'b'], ['a', 'b'])).toEqual({ count: 2, all: true, some: false });
  });

  test('reports some for a partial selection', () => {
    expect(selectionSummary(['a'], ['a', 'b'])).toEqual({ count: 1, all: false, some: true });
  });

  test('an empty available list is neither all nor some', () => {
    // A header checkbox over a workspace with no rows must not claim "all".
    expect(selectionSummary([], [])).toEqual({ count: 0, all: false, some: false });
  });

  test('an id outside the available list does not count', () => {
    expect(selectionSummary(['z'], ['a'])).toEqual({ count: 0, all: false, some: false });
  });
});

describe('selectableSessionIds', () => {
  const sessions = [
    { id: 'a', is_archived: 0 },
    { id: 'b', is_archived: 1 },
    { id: 'c' },
  ];

  test('offers the live rows and skips the archived ones', () => {
    expect(selectableSessionIds(sessions, false)).toEqual(['a', 'c']);
  });

  test('follows the archive filter when it is on', () => {
    expect(selectableSessionIds(sessions, true)).toEqual(['b']);
  });

  test('ids are strings, matching what a checkbox reports', () => {
    expect(selectableSessionIds([{ id: 7 }], false)).toEqual(['7']);
  });
});

describe('liveSelection', () => {
  test('drops an id that is no longer in the list', () => {
    // The two-tab case: one tab deleted the session, so this bar must stop
    // counting it and must never send it.
    expect(liveSelection(['a', 'gone'], ['a', 'b'])).toEqual(['a']);
  });

  test('keeps the recorded order', () => {
    expect(liveSelection(['b', 'a'], ['a', 'b'])).toEqual(['b', 'a']);
  });

  test('an empty available list empties the selection', () => {
    expect(liveSelection(['a'], [])).toEqual([]);
  });
});
