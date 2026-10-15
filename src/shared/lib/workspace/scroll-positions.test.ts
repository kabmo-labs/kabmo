/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The offset map's three rules, each of which fails silently in the app:
 *
 * - the TOP is the absence of an entry, so a reader who scrolled back to line 1
 *   does not leave a `0` per tab in the session's blob for good;
 * - a write that does not move the value returns the SAME object, because every
 *   `setSessionKey` notifies every follower of the slot;
 * - the prune drops only the tabs that are no longer open — a tab id is a hash
 *   of a path, so a kept entry for a closed tab is a stale position that the
 *   next open of that file would apply.
 */

import { describe, expect, test } from 'bun:test';
import {
  dropScrollPosition,
  readScrollTop,
  writeScrollTop,
  type ScrollPositions,
} from '@/shared/lib/workspace/scroll-positions';

describe('readScrollTop', () => {
  test('an absent map, tab or surface reads as the top', () => {
    expect(readScrollTop(undefined, '7', 'code')).toBe(0);
    expect(readScrollTop({}, '7', 'code')).toBe(0);
    expect(readScrollTop({ '7': { unified: 120 } }, '7', 'code')).toBe(0);
    expect(readScrollTop({ '8': { code: 120 } }, '7', 'code')).toBe(0);
  });

  test('a stored offset comes back, and a non-finite one is treated as absent', () => {
    expect(readScrollTop({ '7': { code: 420 } }, '7', 'code')).toBe(420);
    expect(readScrollTop({ '7': { code: Number.NaN } }, '7', 'code')).toBe(0);
    expect(readScrollTop({ '7': { code: -5 } }, '7', 'code')).toBe(0);
  });

  test('the two surfaces of one tab are separate documents', () => {
    const positions: ScrollPositions = { '7': { code: 420, rendered: 40 } };
    expect(readScrollTop(positions, '7', 'code')).toBe(420);
    expect(readScrollTop(positions, '7', 'rendered')).toBe(40);
  });
});

describe('writeScrollTop', () => {
  test('sets one surface and leaves the others alone', () => {
    const before: ScrollPositions = { '7': { code: 100, rendered: 20 }, '8': { code: 5 } };
    const after = writeScrollTop(before, '7', 'code', 300);
    expect(after).toEqual({ '7': { code: 300, rendered: 20 }, '8': { code: 5 } });
    expect(before).toEqual({ '7': { code: 100, rendered: 20 }, '8': { code: 5 } });
  });

  test('an unchanged value returns the input, so no write is scheduled', () => {
    const before: ScrollPositions = { '7': { code: 100 } };
    expect(writeScrollTop(before, '7', 'code', 100)).toBe(before);
    expect(writeScrollTop(undefined, '7', 'code', 0)).toEqual({});
  });

  test('a scroll back to the top REMOVES the entry, and the tab with it', () => {
    const oneSurface = writeScrollTop({ '7': { code: 100, rendered: 20 } }, '7', 'code', 0);
    expect(oneSurface).toEqual({ '7': { rendered: 20 } });
    const noSurfaces = writeScrollTop(oneSurface, '7', 'rendered', 0);
    expect(noSurfaces).toEqual({});
    expect('7' in noSurfaces).toBe(false);
  });
});

describe('dropScrollPosition', () => {
  test('removes one tab and leaves the others alone', () => {
    const before: ScrollPositions = { '1': { code: 10 }, '2': { code: 20 } };
    expect(dropScrollPosition(before, '1')).toEqual({ '2': { code: 20 } });
    expect(before).toEqual({ '1': { code: 10 }, '2': { code: 20 } });
  });

  test('a tab with no entry returns the input, so no write is scheduled', () => {
    const before: ScrollPositions = { '1': { code: 10 } };
    expect(dropScrollPosition(before, '9')).toBe(before);
    expect(dropScrollPosition(undefined, '9')).toEqual({});
  });
});
