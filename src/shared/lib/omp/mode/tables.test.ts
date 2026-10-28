/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The mode tables are read by both the composer strip and the timeline goal
 * card, and by the spawn path that seeds a child. Two spellings of the same
 * figure — or a budget that survives as `0` instead of `null` — is how the
 * strip starts disagreeing with the card it summarizes, or how a "unlimited"
 * goal is created with a budget omp reads as already spent. These tests pin the
 * exact rendered values, the exact status vocabulary, and the one-shot signal
 * encoding the mode hook subscribes to.
 */

import { describe, expect, test } from 'bun:test';

import { normalizeGoalBudget } from '@/shared/lib/omp/mode/budget';
import { KABMO_MODE_SIGNAL, emitKabmoModeSignal } from '@/shared/lib/omp/mode/client-signal';
import { subscribeClientSignal } from '@/client/lib/signals';
import { formatGoalDuration, formatGoalTokens } from '@/shared/lib/omp/mode/format';
import { isGoalOpen } from '@/shared/lib/omp/mode/status';
import {
  CHAMBER_GOAL_STATE_ENTRY,
  CHAMBER_GOAL_STATE_MARKER,
  CHAMBER_MODE_COMMAND,
  CHAMBER_MODE_ERROR_MARKER,
  CHAMBER_MODE_STATE_MARKER,
  CHAMBER_MODES_ENV,
  CHAMBER_PLAN_PROPOSAL_MARKER,
  CHAMBER_PLAN_STATE_ENTRY,
  CHAMBER_PLAN_STATE_MARKER,
  EMPTY_MODE_SELECTION,
  GOAL_CONTINUATION_STOPS,
  KABMO_GOAL_STATE_ENTRY,
  KABMO_GOAL_STATE_MARKER,
  KABMO_MODE_COMMAND,
  KABMO_MODE_ERROR_MARKER,
  KABMO_MODE_STATE_MARKER,
  KABMO_MODES_ENV,
  KABMO_PLAN_PROPOSAL_MARKER,
  KABMO_PLAN_STATE_ENTRY,
  KABMO_PLAN_STATE_MARKER,
  PLAN_REVIEW_CHOICES,
} from '@/shared/lib/omp/mode/types';
import { matchesModeName } from '@/shared/lib/omp/mode/constants';

describe('formatGoalTokens', () => {
  test('below a thousand the rounded integer is shown', () => {
    expect(formatGoalTokens(0)).toBe('0');
    expect(formatGoalTokens(900)).toBe('900');
    expect(formatGoalTokens(999)).toBe('999');
    expect(formatGoalTokens(999.4)).toBe('999');
  });

  test('thousands keep one decimal below 10k and none above', () => {
    expect(formatGoalTokens(1000)).toBe('1k');
    expect(formatGoalTokens(1500)).toBe('1.5k');
    expect(formatGoalTokens(9400)).toBe('9.4k');
    expect(formatGoalTokens(12_400)).toBe('12k');
    expect(formatGoalTokens(451_800)).toBe('452k');
  });

  test('9999 rounds up to 10k rather than printing a 10.0k', () => {
    // The >=10 branch rounds and drops the decimal, so the sub-10k "one
    // decimal" rule never emits "10.0k".
    expect(formatGoalTokens(9999)).toBe('10k');
  });

  test('millions use the M suffix with one decimal', () => {
    expect(formatGoalTokens(1_000_000)).toBe('1M');
    expect(formatGoalTokens(1_500_000)).toBe('1.5M');
    expect(formatGoalTokens(12_345_678)).toBe('12.3M');
  });
});

describe('formatGoalDuration', () => {
  test('under a minute is whole seconds', () => {
    expect(formatGoalDuration(0)).toBe('0s');
    expect(formatGoalDuration(45)).toBe('45s');
    expect(formatGoalDuration(59.6)).toBe('60s');
  });

  test('minutes, then hours and minutes', () => {
    expect(formatGoalDuration(60)).toBe('1m');
    expect(formatGoalDuration(90)).toBe('1m');
    expect(formatGoalDuration(3599)).toBe('59m');
    expect(formatGoalDuration(3600)).toBe('1h 0m');
    expect(formatGoalDuration(3700)).toBe('1h 1m');
    expect(formatGoalDuration(7325)).toBe('2h 2m');
  });
});

describe('isGoalOpen', () => {
  test('active, paused and budget-limited keep the goal in the composer', () => {
    expect(isGoalOpen('active')).toBe(true);
    expect(isGoalOpen('paused')).toBe(true);
    expect(isGoalOpen('budget-limited')).toBe(true);
  });

  test('complete and dropped are transcript-only', () => {
    expect(isGoalOpen('complete')).toBe(false);
    expect(isGoalOpen('dropped')).toBe(false);
  });
});

describe('normalizeGoalBudget', () => {
  test('a positive integer passes through', () => {
    expect(normalizeGoalBudget(100)).toBe(100);
    expect(normalizeGoalBudget('100')).toBe(100);
    expect(normalizeGoalBudget(' 42 ')).toBe(42);
  });

  test('zero, negatives and non-integers mean "no budget", not "zero"', () => {
    // omp reads a 0 budget as already spent; the value must become null.
    expect(normalizeGoalBudget(0)).toBeNull();
    expect(normalizeGoalBudget('0')).toBeNull();
    expect(normalizeGoalBudget(-5)).toBeNull();
    expect(normalizeGoalBudget(1.5)).toBeNull();
    expect(normalizeGoalBudget('1.5')).toBeNull();
  });

  test('blank, unparsable and non-numeric input means "no budget"', () => {
    expect(normalizeGoalBudget('')).toBeNull();
    expect(normalizeGoalBudget('   ')).toBeNull();
    expect(normalizeGoalBudget('abc')).toBeNull();
    expect(normalizeGoalBudget(null)).toBeNull();
    expect(normalizeGoalBudget(undefined)).toBeNull();
    expect(normalizeGoalBudget(true)).toBeNull();
    expect(normalizeGoalBudget(Number.NaN)).toBeNull();
    expect(normalizeGoalBudget(Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe('mode constants', () => {
  test('the continuation-stop vocabulary is exact and ordered', () => {
    expect(GOAL_CONTINUATION_STOPS).toEqual(['budget', 'max-turns', 'blocked', 'complete', 'audit-failed']);
  });

  test('the review choices keep the TUI order', () => {
    expect(PLAN_REVIEW_CHOICES).toEqual([
      'Approve and execute',
      'Approve and compact context',
      'Approve and keep context',
      'Refine plan',
      'Save and quit',
    ]);
  });

  test('the default selection has both modes off', () => {
    expect(EMPTY_MODE_SELECTION).toEqual({ plan: false, goal: false });
  });

  test('wire identifiers match the extension contract', () => {
    expect(KABMO_MODES_ENV).toBe('KABMO_MODES');
    expect(KABMO_MODE_COMMAND).toBe('kabmo-mode');
    expect(KABMO_GOAL_STATE_ENTRY).toBe('kabmo-goal-state');
    expect(KABMO_PLAN_STATE_ENTRY).toBe('kabmo-plan-state');
  });

  test('the pre-rename spellings survive as read-side constants', () => {
    // A resumed session's JSONL carries these, and the extension file on disk
    // may still be the one that emits them.
    expect(CHAMBER_MODES_ENV).toBe('CHAMBER_MODES');
    expect(CHAMBER_MODE_COMMAND).toBe('chamber-mode');
    expect(CHAMBER_GOAL_STATE_ENTRY).toBe('chamber-goal-state');
    expect(CHAMBER_PLAN_STATE_ENTRY).toBe('chamber-plan-state');
  });

  test('marker prefixes are exact and colon-terminated, under both spellings', () => {
    expect(KABMO_PLAN_STATE_MARKER).toBe('KABMO_PLAN_STATE:');
    expect(KABMO_GOAL_STATE_MARKER).toBe('KABMO_GOAL_STATE:');
    expect(KABMO_MODE_STATE_MARKER).toBe('KABMO_MODE_STATE:');
    expect(KABMO_MODE_ERROR_MARKER).toBe('KABMO_MODE_ERROR:');
    expect(KABMO_PLAN_PROPOSAL_MARKER).toBe('KABMO_PLAN_PROPOSAL:');

    expect(CHAMBER_PLAN_STATE_MARKER).toBe('CHAMBER_PLAN_STATE:');
    expect(CHAMBER_GOAL_STATE_MARKER).toBe('CHAMBER_GOAL_STATE:');
    expect(CHAMBER_MODE_STATE_MARKER).toBe('CHAMBER_MODE_STATE:');
    expect(CHAMBER_MODE_ERROR_MARKER).toBe('CHAMBER_MODE_ERROR:');
    expect(CHAMBER_PLAN_PROPOSAL_MARKER).toBe('CHAMBER_PLAN_PROPOSAL:');
  });

  test('the read predicate accepts both spellings and nothing else', () => {
    expect(matchesModeName('modeCommand', 'kabmo-mode')).toBe(true);
    expect(matchesModeName('modeCommand', 'chamber-mode')).toBe(true);
    expect(matchesModeName('modeCommand', 'mode')).toBe(false);
  });
});

describe('emitKabmoModeSignal', () => {
  test('publishes the signal scoped by session id', () => {
    const seen: unknown[] = [];
    const unsubscribe = subscribeClientSignal(KABMO_MODE_SIGNAL, (payload) => { seen.push(payload); });
    emitKabmoModeSignal('session-1', { marker: 'KABMO_MODE_STATE:', payload: { enabled: true } });
    unsubscribe();
    expect(seen).toEqual([{ sessionId: 'session-1', marker: { marker: 'KABMO_MODE_STATE:', payload: { enabled: true } } }]);
  });

  test('an undefined session id is preserved', () => {
    const seen: unknown[] = [];
    const unsubscribe = subscribeClientSignal(KABMO_MODE_SIGNAL, (payload) => { seen.push(payload); });
    emitKabmoModeSignal(undefined, { marker: 'KABMO_MODE_STATE:', payload: {} });
    unsubscribe();
    expect(seen).toEqual([{ sessionId: undefined, marker: { marker: 'KABMO_MODE_STATE:', payload: {} } }]);
  });

  test('a listener that throws does not stop the others', () => {
    const seen: unknown[] = [];
    const unsubscribeBad = subscribeClientSignal(KABMO_MODE_SIGNAL, () => { throw new Error('boom'); });
    const unsubscribeGood = subscribeClientSignal(KABMO_MODE_SIGNAL, (payload) => { seen.push(payload); });
    emitKabmoModeSignal('session-1', { marker: 'KABMO_MODE_STATE:', payload: {} });
    unsubscribeBad();
    unsubscribeGood();
    expect(seen).toHaveLength(1);
  });
});
