/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The Token Usage panel's view models.
 *
 * These are the numbers a user reads, so each case pins a value that would be a
 * bug if it drifted: a model shown under the wrong provider, a share computed
 * against the wrong denominator, a cadence that relabels without re-bucketing,
 * or a cache rate that divides by the wrong input.
 */

import { describe, expect, test } from 'bun:test';

import {
  cacheHitLabel,
  cacheHitRate,
  costLabel,
  costPerMillionLabel,
  tokenLabel,
  toMetricSet,
} from '@/shared/lib/usage/view';
import type { UsageTotals } from '@/shared/types';

const counters = (cost: number, tokens: number, records = 1, cacheRead = 0, input = 0) => ({
  cost, tokens, input, output: tokens - input - cacheRead, cacheRead, cacheWrite: 0,
  reasoning: 0, cacheReadCost: cost * 0.1, records, unpriced: 0,
});

const totals: UsageTotals = {
  ...counters(20, 1_000_000, 40, 900_000, 50_000),
  unpriced: 4,
  activeDays: 6,
};

describe('formatting', () => {
  test('token labels switch unit at the decimal boundary', () => {
    expect(tokenLabel(0)).toBe('0');
    expect(tokenLabel(999)).toBe('999');
    expect(tokenLabel(1_500)).toBe('1.5K');
    expect(tokenLabel(2_219_000_000)).toBe('2.2B');
  });

  test('a nonzero sub-cent cost is not rounded into "free"', () => {
    expect(costLabel(0)).toBe('$0.00');
    expect(costLabel(1.234)).toBe('$1.23');
    expect(costLabel(0.0009)).toBe('< $0.01');
    expect(costLabel(0.01)).toBe('$0.01');
  });

  test('cost per million is derived from cost and tokens, and blank when empty', () => {
    expect(costPerMillionLabel({ cost: 1.7, tokens: 1_000_000 })).toBe('$1.70');
    expect(costPerMillionLabel({ cost: 1.7, tokens: 0 })).toBe('—');
  });

  test('cache hit rate is cache reads over ALL observed input', () => {
    expect(cacheHitRate({ cacheRead: 900, input: 100 })).toBeCloseTo(0.9, 10);
    expect(cacheHitLabel({ cacheRead: 900, input: 100 })).toBe('90.0%');
    // Nothing observed is not a 100% hit rate.
    expect(cacheHitLabel({ cacheRead: 0, input: 0 })).toBe('—');
  });
});

describe('toMetricSet', () => {
  test('every figure is the period total', () => {
    const metrics = toMetricSet(totals);
    expect(metrics.rawCost).toBe('$20.00');
    expect(metrics.processedTokens).toBe('1.0M');
    expect(metrics.cachedInput).toBe('900.0K');
    expect(metrics.uncachedInput).toBe('50.0K');
    expect(metrics.costPerMillion).toBe('$20.00');
  });

  test('the activity hint counts the period days, singular at one', () => {
    expect(toMetricSet(totals).activeRate).toBe('6 active days');
    expect(toMetricSet({ ...totals, activeDays: 1 }).activeRate).toBe('1 active day');
  });

  test('there is no per-day or per-week figure in the set', () => {
    const metrics = toMetricSet(totals);
    expect(Object.keys(metrics).some((key) => /perDay|perWeek|perMonth|average/i.test(key))).toBe(false);
  });
});
