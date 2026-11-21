/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The vocabulary. Every case here is a word GitHub actually sends, and the two
 * failures this file exists to prevent are a real failure painted green and an
 * unfinished run painted grey.
 */

import { describe, expect, test } from 'bun:test';

import { stateOf, worstState } from './state';

describe('stateOf', () => {
  test('a finished run reads its conclusion', () => {
    expect(stateOf('completed', 'success')).toBe('success');
    expect(stateOf('completed', 'failure')).toBe('failure');
    expect(stateOf('completed', 'timed_out')).toBe('failure');
    expect(stateOf('completed', 'action_required')).toBe('failure');
  });

  test('a skipped or cancelled job is not a pass', () => {
    expect(stateOf('completed', 'skipped')).toBe('neutral');
    expect(stateOf('completed', 'cancelled')).toBe('neutral');
    expect(stateOf('completed', 'canceled')).toBe('neutral');
  });

  test('a run in flight is pending although its conclusion is null', () => {
    expect(stateOf('in_progress', null)).toBe('pending');
    expect(stateOf('queued', null)).toBe('pending');
    expect(stateOf('waiting', null)).toBe('pending');
    expect(stateOf('pending', null)).toBe('pending');
  });

  test('an unknown word is neutral, never failure and never success', () => {
    expect(stateOf('completed', 'brand_new_conclusion')).toBe('neutral');
    expect(stateOf('who_knows', null)).toBe('neutral');
    expect(stateOf('', '')).toBe('neutral');
    expect(stateOf(null, undefined)).toBe('neutral');
  });
});

describe('worstState', () => {
  test('one failing job fails the roll-up', () => {
    expect(worstState(['success', 'success', 'failure'])).toBe('failure');
    expect(worstState(['success', 'pending'])).toBe('pending');
    expect(worstState(['success', 'neutral'])).toBe('neutral');
  });

  test('an empty list has no state at all', () => {
    expect(worstState([])).toBeNull();
  });
});
