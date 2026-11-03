/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Breakdown and chart view models (`breakdown.ts`).
 *
 * These are the rows a user reads, so each case pins a value that would be a
 * bug if it drifted: a model shown under the wrong provider, a share computed
 * against the wrong denominator, a cadence that relabels without re-bucketing,
 * or a per-bucket average divided by the wrong count.
 */

import { describe, expect, test } from 'bun:test';

import {
  breakdownRows,
  bucketDays,
  chartSeries,
  dayRows,
  providerModelRows,
} from '@/shared/lib/usage/breakdown';
import type { UsageDayRow, UsageProviderRow, UsageTotals } from '@/shared/types';

const counters = (cost: number, tokens: number, records = 1, cacheRead = 0, input = 0) => ({
  cost, tokens, input, output: tokens - input - cacheRead, cacheRead, cacheWrite: 0,
  reasoning: 0, cacheReadCost: cost * 0.1, records, unpriced: 0,
});

const provider = (id: string, name: string, models: Array<[string, number, number]>): UsageProviderRow => {
  const rows = models.map(([model, cost, tokens]) => ({ model, ...counters(cost, tokens) }));
  return {
    id,
    name,
    models: rows,
    ...rows.reduce(
      (acc, row) => ({
        ...acc,
        cost: acc.cost + row.cost,
        tokens: acc.tokens + row.tokens,
        records: acc.records + row.records,
      }),
      { cost: 0, tokens: 0, records: 0 },
    ),
    input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, cacheReadCost: 0, unpriced: 0,
  } as UsageProviderRow;
};

const totals: UsageTotals = {
  ...counters(20, 1_000_000, 40, 900_000, 50_000),
  unpriced: 4,
  activeDays: 6,
};

const day = (key: string, cost: number, tokens: number, providers: Record<string, { cost: number; tokens: number }>): UsageDayRow => ({
  day: key,
  providers,
  ...counters(cost, tokens),
});

describe('bucketDays', () => {
  const days = [
    day('2026-10-31', 1, 10, { kenari: { cost: 1, tokens: 10 } }),
    day('2026-11-02', 3, 30, { 'kenari-jatis': { cost: 2, tokens: 20 }, kenari: { cost: 1, tokens: 10 } }),
    day('2026-11-03', 4, 40, { 'kenari-jatis': { cost: 4, tokens: 40 } }),
  ];

  test('a week merges its days and sums each provider separately', () => {
    const buckets = bucketDays(days, 'week');
    // Oct 31 is a Saturday in the week of Oct 26; Nov 2–3 fall in the week of Nov 2.
    expect(buckets.map((bucket) => bucket.label)).toEqual(['Oct 26', 'Nov 2']);
    expect(buckets[1].cost).toBe(7);
    expect(buckets[1].byProvider['kenari-jatis']).toEqual({ cost: 6, tokens: 60 });
    expect(buckets[1].byProvider.kenari).toEqual({ cost: 1, tokens: 10 });
  });

  test('a month keeps one bucket per month, ordered', () => {
    const buckets = bucketDays(days, 'month');
    expect(buckets.map((bucket) => bucket.label)).toEqual(['Oct', 'Nov']);
    expect(buckets[1].cost).toBe(7);
  });

  test('the flat series matches the buckets it summarises', () => {
    expect(chartSeries(days, 'day')).toEqual([
      { label: 'Oct 31', cost: 1, tokens: 10 },
      { label: 'Nov 2', cost: 3, tokens: 30 },
      { label: 'Nov 3', cost: 4, tokens: 40 },
    ]);
  });
});

describe('providerModelRows', () => {
  const providers = [
    provider('kenari-jatis', 'Kenari Jatis', [['deepseek-v4-1-flash', 18, 900]]),
    provider('kenari', 'Kenari.id', [['deepseek-v4-1-flash', 1.5, 80], ['minimax-m3', 0.5, 20]]),
  ];

  test('one model id under two providers is two subtrees, not one row', () => {
    const rows = providerModelRows(providers, 20);
    expect(rows.map((row) => `${row.kind}:${row.label}`)).toEqual([
      'group:Kenari Jatis',
      'row:deepseek-v4-1-flash',
      'group:Kenari.id',
      'row:deepseek-v4-1-flash',
      'row:minimax-m3',
    ]);
    // Keys stay unique even where the label repeats.
    expect(new Set(rows.map((row) => row.key)).size).toBe(rows.length);
  });

  test('model share is of the period, and of its provider', () => {
    const rows = providerModelRows(providers, 20);
    const jatisModel = rows[1];
    expect(jatisModel.sharePercent).toBe(90);
    expect(jatisModel.shareOfParentPercent).toBe(100);
    const kenariSmall = rows[4];
    expect(kenariSmall.sharePercent).toBe(2.5);
    expect(kenariSmall.shareOfParentPercent).toBe(25);
  });

  test('a row is the period total, with no derived per-day figure', () => {
    const rows = providerModelRows(providers, 20);
    expect(rows[0].cost).toBe(18);
    expect(rows[1].cost).toBe(18);
    expect(rows[1].tokens).toBe(900);
    expect('display' in rows[1]).toBe(false);
  });

  test('a zero total does not divide by zero', () => {
    const rows = providerModelRows([provider('x', 'X', [['m', 0, 0]])], 0);
    expect(rows.every((row) => row.sharePercent === 0)).toBe(true);
  });
});

describe('dayRows', () => {
  const days = [
    day('2026-11-02', 1, 10, { kenari: { cost: 1, tokens: 10 } }),
    day('2026-11-03', 3, 30, { kenari: { cost: 3, tokens: 30 } }),
  ];

  test('lists the period oldest first, and a quiet day is still listed', () => {
    // Nov 1 has no records at all; the table must still show it, or the list
    // silently stops matching the period it claims to describe.
    const rows = dayRows(days, 'day', 4, { from: '2026-11-01', to: '2026-11-03' });
    expect(rows.map((row) => row.label)).toEqual(['Nov 1', 'Nov 2', 'Nov 3']);
    expect(rows[0].cost).toBe(0);
    expect(rows[0].sharePercent).toBe(0);
    expect(rows[2].sharePercent).toBe(75);
  });

  test('a weekly bucket sums the week into one row per week of the period', () => {
    const rows = dayRows(days, 'week', 4, { from: '2026-11-02', to: '2026-11-03' });
    expect(rows).toHaveLength(1);
    expect(rows[0].label).toBe('Nov 2');
    expect(rows[0].cost).toBe(4);
    expect(rows[0].records).toBe(2);
  });

  test('all time lists every month between its first and last recorded day', () => {
    // A quiet month in the middle of the history must not vanish: the rows
    // have to add up to the totals shown beside them.
    const rows = dayRows(
      [day('2026-06-24', 1, 10, { kenari: { cost: 1, tokens: 10 } }), day('2026-08-02', 2, 20, { kenari: { cost: 2, tokens: 20 } })],
      'month',
      3,
      { from: '2026-06-24', to: '2026-08-02' },
    );
    expect(rows.map((row) => row.label)).toEqual(['Jun', 'Jul', 'Aug']);
    expect(rows[1].cost).toBe(0);
  });

  test('without a window only the days that saw usage are listed', () => {
    // All-time has no bounded window, so the rollup's own days are the list.
    const rows = dayRows(days, 'day', 4, null);
    expect(rows.map((row) => row.label)).toEqual(['Nov 2', 'Nov 3']);
  });
});

describe('breakdownRows', () => {
  const providers = [provider('kenari', 'Kenari.id', [['m', 4, 40]])];
  const payload = {
    totals: { ...totals, cost: 4, tokens: 40, activeDays: 1 },
    providers,
    days: [day('2026-11-03', 4, 40, { kenari: { cost: 4, tokens: 40 } })],
    projects: [],
  };

  test('provider and model tabs draw the same tree', () => {
    expect(breakdownRows('provider', payload, 'day', null)).toEqual(breakdownRows('model', payload, 'day', null));
  });

  test('each tab selects its own source', () => {
    expect(breakdownRows('day', payload, 'day', null)[0].label).toBe('Nov 3');
    expect(breakdownRows('project', payload, 'day', null)).toEqual([]);
  });
});
