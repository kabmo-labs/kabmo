/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The split editor's rules.
 *
 * Every one of them prevents a pane that cannot be used: a split onto the tab the left pane
 * already shows is a wide pane with a divider through it; a persisted id for a tab that is
 * gone opens onto an empty half-column the user has to discover how to dismiss; a divider
 * dragged to either extreme deletes a pane by accident.
 */

import { describe, expect, test } from 'bun:test';

import {
  DEFAULT_SPLIT,
  MAX_SPLIT_FRACTION,
  MIN_SPLIT_FRACTION,
  canSplitTo,
  clampSplitFraction,
  readSplitState,
  splitAfterActivate,
} from '@/shared/lib/workspace/split-editor';

describe('canSplitTo', () => {
  test('a second open tab can be the right pane', () => {
    expect(canSplitTo('b.ts', 'a.ts', ['a.ts', 'b.ts'])).toBe(true);
  });

  test('the tab the left pane already shows is refused — one file twice is not a split', () => {
    expect(canSplitTo('a.ts', 'a.ts', ['a.ts', 'b.ts'])).toBe(false);
  });

  test('a tab that is not open is refused', () => {
    expect(canSplitTo('gone.ts', 'a.ts', ['a.ts'])).toBe(false);
  });

  test('null is refused, which is what closes the pane', () => {
    expect(canSplitTo(null, 'a.ts', ['a.ts'])).toBe(false);
  });
});

describe('splitAfterActivate', () => {
  test('activating the tab the right pane shows collapses the split', () => {
    const state = { rightFileId: 'b.ts', fraction: 0.5 };
    expect(splitAfterActivate(state, 'b.ts')).toEqual({ rightFileId: null, fraction: 0.5 });
  });

  test('activating another tab leaves the split standing', () => {
    const state = { rightFileId: 'b.ts', fraction: 0.5 };
    expect(splitAfterActivate(state, 'c.ts')).toBe(state);
  });

  test('an unsplit column is untouched', () => {
    expect(splitAfterActivate(DEFAULT_SPLIT, 'a.ts')).toBe(DEFAULT_SPLIT);
  });
});

describe('clampSplitFraction', () => {
  test('keeps a position inside the bounds', () => {
    expect(clampSplitFraction(0.5)).toBe(0.5);
    expect(clampSplitFraction(0.9)).toBe(MAX_SPLIT_FRACTION);
    expect(clampSplitFraction(0.05)).toBe(MIN_SPLIT_FRACTION);
  });

  test('a non-finite value falls back to the default', () => {
    expect(clampSplitFraction(Number.NaN)).toBe(DEFAULT_SPLIT.fraction);
    expect(clampSplitFraction(Number.POSITIVE_INFINITY)).toBe(DEFAULT_SPLIT.fraction);
  });
});

describe('readSplitState', () => {
  test('a valid persisted state is restored', () => {
    expect(readSplitState({ rightFileId: 'b.ts', fraction: 0.3 }, ['a.ts', 'b.ts'])).toEqual({
      rightFileId: 'b.ts',
      fraction: 0.3,
    });
  });

  test('a right pane naming a tab that is gone is DROPPED, not trusted', () => {
    // The split would otherwise open onto a pane that cannot render, and the only way out
    // would be to close a pane nobody can see.
    expect(readSplitState({ rightFileId: 'gone.ts', fraction: 0.3 }, ['a.ts'])).toEqual({
      rightFileId: null,
      fraction: 0.3,
    });
  });

  test('the fraction survives even when the pane is dropped, so a later split keeps it', () => {
    expect(readSplitState({ rightFileId: 'gone.ts', fraction: 0.7 }, []).fraction).toBe(0.7);
  });

  test('a malformed blob answers the default', () => {
    expect(readSplitState(null, [])).toEqual(DEFAULT_SPLIT);
    expect(readSplitState('nonsense', [])).toEqual(DEFAULT_SPLIT);
    expect(readSplitState({}, [])).toEqual(DEFAULT_SPLIT);
  });

  test('an out-of-bounds fraction is clamped on read', () => {
    expect(readSplitState({ rightFileId: 'a.ts', fraction: 0.99 }, ['a.ts']).fraction).toBe(MAX_SPLIT_FRACTION);
  });
});
