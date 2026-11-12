/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The composer's recall cursor: no wrap at either end, the draft restored on
 * the way back down, and the caret rules that keep a multi-line draft's arrows
 * ordinary.
 */

import { describe, expect, test } from 'bun:test';
import { canRecallDown, canRecallUp, stepHistoryCursor } from '@/shared/lib/chat/composer/history';

describe('stepHistoryCursor', () => {
  test('ArrowUp enters the newest entry from the draft', () => {
    expect(stepHistoryCursor(3, -1, 'up')).toBe(0);
  });

  test('ArrowUp walks older and stops at the oldest entry', () => {
    expect(stepHistoryCursor(3, 0, 'up')).toBe(1);
    expect(stepHistoryCursor(3, 1, 'up')).toBe(2);
    expect(stepHistoryCursor(3, 2, 'up')).toBeNull();
  });

  test('ArrowDown walks newer and returns to the draft', () => {
    expect(stepHistoryCursor(3, 2, 'down')).toBe(1);
    expect(stepHistoryCursor(3, 0, 'down')).toBe(-1);
  });

  test('ArrowDown from the draft is not a recall', () => {
    expect(stepHistoryCursor(3, -1, 'down')).toBeNull();
  });

  test('an empty list recalls nothing', () => {
    expect(stepHistoryCursor(0, -1, 'up')).toBeNull();
    expect(stepHistoryCursor(0, 0, 'down')).toBeNull();
  });
});

describe('canRecallUp', () => {
  test('an empty draft recalls', () => {
    expect(canRecallUp('', 0)).toBe(true);
  });

  test('the first line recalls', () => {
    expect(canRecallUp('one line', 4)).toBe(true);
  });

  test('a caret below the first line moves the caret instead', () => {
    expect(canRecallUp('first\nsecond', 8)).toBe(false);
  });

  test('a caret at the start of the second line still moves the caret', () => {
    expect(canRecallUp('first\nsecond', 6)).toBe(false);
  });
});

describe('canRecallDown', () => {
  test('the last line recalls', () => {
    expect(canRecallDown('first\nsecond', 12)).toBe(true);
  });

  test('a caret above the last line moves the caret instead', () => {
    expect(canRecallDown('first\nsecond', 2)).toBe(false);
  });
});
