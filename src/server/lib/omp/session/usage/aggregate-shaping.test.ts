/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The presentation shaping over the usage rollup (`shaping.ts`): labels,
 * buckets, chart series and metric sets over an already-built aggregate.
 * Split verbatim from `aggregate.test.ts` so both files stay under the repo's
 * 350-line ceiling; the scanning and arithmetic live in that file.
 */

import { describe, expect, test } from 'bun:test';

import type { UsageAggregate } from '@/server/lib/omp/session/usage/aggregate';
import { buildChartSeries, toBreakdownRows, toMetricSet } from '@/server/lib/omp/session/usage/shaping';

function agg(partial: Partial<UsageAggregate> = {}): UsageAggregate {
  return {
    scannedTranscripts: 0, usageRecords: 0, costTotal: 0, costInput: 0, costOutput: 0,
    costCacheRead: 0, costCacheWrite: 0, inputTokens: 0, outputTokens: 0,
    cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0,
    activeDays: new Set<string>(), byModel: new Map(), byDay: new Map(), byProject: new Map(),
    ...partial,
  };
}

describe('buildChartSeries', () => {
  test('daily points are sorted ascending and labelled with the day', () => {
    const a = agg({ byDay: new Map([['1999-09-07', { tokens: 20, cost: 2 }], ['1999-09-05', { tokens: 10, cost: 1 }]]) });
    expect(buildChartSeries(a, 'daily')).toEqual([
      { label: 'Sep 5', cost: 1, tokens: 10 },
      { label: 'Sep 7', cost: 2, tokens: 20 },
    ]);
  });

  test('weekly buckets align to Monday, merging the days of one week', () => {
    const a = agg({
      byDay: new Map([
        ['1999-09-06', { tokens: 10, cost: 1 }], // Monday
        ['1999-09-08', { tokens: 20, cost: 2 }], // Wednesday, same week
        ['1999-09-20', { tokens: 30, cost: 3 }], // two weeks later
      ]),
    });
    expect(buildChartSeries(a, 'weekly')).toEqual([
      { label: 'Sep 6', cost: 3, tokens: 30 },
      { label: 'Sep 20', cost: 3, tokens: 30 },
    ]);
  });

  test('monthly buckets merge by calendar month and name the year when it is not the current one', () => {
    const a = agg({ byDay: new Map([['1999-09-05', { tokens: 10, cost: 1 }], ['1999-09-25', { tokens: 5, cost: 0.5 }], ['1998-12-01', { tokens: 1, cost: 0.1 }]]) });
    expect(buildChartSeries(a, 'monthly')).toEqual([
      { label: 'Dec 1998', cost: 0.1, tokens: 1 },
      { label: 'Sep 1999', cost: 1.5, tokens: 15 },
    ]);
  });

  test('truncates to the last 60 buckets', () => {
    const byDay = new Map<string, { tokens: number; cost: number }>();
    for (let i = 0; i < 61; i++) {
      const d = new Date(1999, 0, 1 + i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      byDay.set(key, { tokens: i, cost: i });
    }
    const series = buildChartSeries(agg({ byDay }), 'daily');
    expect(series).toHaveLength(60);
    expect(series[0].tokens).toBe(1); // the oldest day fell off
    expect(series[59].tokens).toBe(60);
  });
});

describe('toMetricSet', () => {
  test('zeroes render as zeros, never NaN', () => {
    expect(toMetricSet(agg())).toEqual({
      rawCost: '$0.00', processedTokens: '0', activeRate: '0 active days', cachedInput: '0',
      cachedPercent: '0.0% of observed input', uncachedInput: '0', outputTokens: '0',
      reasoning: 'includes 0 reasoning', cacheSavings: '$0.00', scannedTranscripts: 0, usageRecords: 0,
    });
  });

  test('formats the aggregate, with the cache rate over observed input only', () => {
    const a = agg({
      costTotal: 2.95, costCacheRead: 0.05, inputTokens: 1000, outputTokens: 250,
      cacheReadTokens: 250, cacheWriteTokens: 0, reasoningTokens: 7, scannedTranscripts: 3, usageRecords: 4,
      activeDays: new Set(['d1', 'd2', 'd3']),
    });
    expect(toMetricSet(a)).toEqual({
      rawCost: '$2.95', processedTokens: '1,500', activeRate: '3 active days', cachedInput: '250',
      cachedPercent: '20.0% of observed input', uncachedInput: '1,000', outputTokens: '250',
      reasoning: 'includes 7 reasoning', cacheSavings: '$0.05', scannedTranscripts: 3, usageRecords: 4,
    });
  });

  test('the active-rate unit and plural follow the cadence', () => {
    const one = agg({ activeDays: new Set(['d1']) });
    expect(toMetricSet(one, 'weekly').activeRate).toBe('1 active week');
    expect(toMetricSet(one, 'monthly').activeRate).toBe('1 active month');
    expect(toMetricSet(one, 'daily').activeRate).toBe('1 active day');
    expect(toMetricSet(agg({ activeDays: new Set(['a', 'b']) }), 'monthly').activeRate).toBe('2 active months');
  });
});

describe('toBreakdownRows', () => {
  test('model rows are sorted by cost, formatted, and share the total', () => {
    const a = agg({
      costTotal: 2,
      byModel: new Map([['b', { tokens: 500, cost: 0.5 }], ['a', { tokens: 1500, cost: 1.5 }]]),
    });
    expect(toBreakdownRows(a, 'model')).toEqual([
      { name: 'a', tokens: '1,500', cost: '$1.50', share: '75%', sharePercent: 75, dotColorClass: 'bg-[var(--theme-ink)]' },
      { name: 'b', tokens: '500', cost: '$0.50', share: '25%', sharePercent: 25, dotColorClass: 'bg-[var(--theme-ink)]/70' },
    ]);
  });

  test('a zero-cost aggregate reports 0% shares instead of dividing by zero', () => {
    const rows = toBreakdownRows(agg({ byModel: new Map([['a', { tokens: 5, cost: 0 }]]) }), 'model');
    expect(rows[0].share).toBe('0%');
    expect(rows[0].sharePercent).toBe(0);
  });

  test('keeps only the twelve costliest rows and cycles the dot colours', () => {
    const byProject = new Map<string, { tokens: number; cost: number }>();
    for (let i = 0; i < 13; i++) byProject.set(`p${i}`, { tokens: i, cost: i });
    const rows = toBreakdownRows(agg({ costTotal: 78, byProject }), 'project');
    expect(rows).toHaveLength(12);
    expect(rows[0].name).toBe('p12');
    expect(rows[11].name).toBe('p1');
    expect(rows[5].dotColorClass).toBe(rows[0].dotColorClass); // five colours, cycled
  });

  test('the day tab is bucketed by the cadence', () => {
    const a = agg({ costTotal: 1.5, byDay: new Map([['1999-09-05', { tokens: 10, cost: 1 }], ['1999-09-25', { tokens: 5, cost: 0.5 }]]) });
    // A non-daily cadence buckets first, then re-enters with 'daily' — and the
    // 'YYYY-MM' bucket key is then labelled by `dayLabel`, which parses it as
    // the 1st of that month. The chart series for the same cadence says
    // "Sep 1999", so the two surfaces disagree (see the report note).
    expect(toBreakdownRows(a, 'day', 'monthly')).toEqual([
      { name: 'Sep 1', tokens: '15', cost: '$1.50', share: '100%', sharePercent: 100, dotColorClass: 'bg-[var(--theme-ink)]' },
    ]);
    // Sep 5 1999 is a Sunday (→ Mon Aug 30) and Sep 25 a Saturday (→ Mon Sep
    // 20), so the two days land in different weeks.
    expect(toBreakdownRows(a, 'day', 'weekly')).toEqual([
      { name: 'Aug 30', tokens: '10', cost: '$1.00', share: '67%', sharePercent: 67, dotColorClass: 'bg-[var(--theme-ink)]' },
      { name: 'Sep 20', tokens: '5', cost: '$0.50', share: '33%', sharePercent: 33, dotColorClass: 'bg-[var(--theme-ink)]/70' },
    ]);
    expect(toBreakdownRows(a, 'day', 'daily').map((r) => r.name)).toEqual(['Sep 5', 'Sep 25']);
  });
});
