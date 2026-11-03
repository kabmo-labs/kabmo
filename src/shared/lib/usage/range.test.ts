/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Day arithmetic for the Token Usage surface.
 *
 * The server decides which rows a period includes and the client buckets those
 * days for the cadence switch, so both sides call THIS module. The cases worth
 * pinning are the ones that made the panel disagree with itself: a UTC-derived
 * day beside a local "Today", a week starting on Sunday, and "last 7 days"
 * silently meaning 7 × 24 h instead of 7 calendar days.
 */

import { describe, expect, test } from 'bun:test';

import {
  bucketKey,
  bucketLabel,
  compareDayKeys,
  dayKeyOfTimestamp,
  dayLabel,
  dayRangeLabel,
  dayWindow,
  daysInWindow,
  granularityFor,
  localDayKey,
  spanOfDays,
  parseIsoDay,
  timeRangeOptions,
} from '@/shared/lib/usage/range';

/** A local-time instant, so the cases read the same in every timezone. */
const at = (year: number, month: number, day: number, hour = 12) => new Date(year, month - 1, day, hour, 0, 0).getTime();
const NOW = at(2026, 11, 3);

describe('localDayKey', () => {
  test('is the local calendar day, not the UTC prefix', () => {
    // 00:30 local is the previous UTC day west of UTC and the same day east of
    // it; the assertion that matters is that it equals the LOCAL date.
    const instant = at(2026, 11, 3, 0);
    expect(localDayKey(instant)).toBe('2026-11-03');
    expect(localDayKey(at(2026, 11, 3, 23))).toBe('2026-11-03');
  });

  test('an ISO timestamp with no timezone parses as local', () => {
    expect(dayKeyOfTimestamp(new Date(2026, 10, 3, 1, 5).toISOString())).toBe('2026-11-03');
  });

  test('a missing or unparseable timestamp yields an empty key', () => {
    expect(dayKeyOfTimestamp(undefined)).toBe('');
    expect(dayKeyOfTimestamp('')).toBe('');
    expect(dayKeyOfTimestamp('not-a-date')).toBe('');
  });
});

describe('parseIsoDay', () => {
  test('accepts real calendar days only', () => {
    expect(parseIsoDay('2026-02-28')).toBe('2026-02-28');
    expect(parseIsoDay('2026-02-30')).toBeNull();
    expect(parseIsoDay('2026-13-01')).toBeNull();
    expect(parseIsoDay('3/11/2026')).toBeNull();
    expect(parseIsoDay('')).toBeNull();
  });
});

describe('dayWindow', () => {
  test('today is one local calendar day', () => {
    expect(dayWindow('today', NOW)).toEqual({ from: '2026-11-03', to: '2026-11-03' });
  });

  test('last 7 days covers seven calendar days including today', () => {
    expect(dayWindow('7d', NOW)).toEqual({ from: '2026-10-28', to: '2026-11-03' });
  });

  test('last 30 and 90 days scale the same way', () => {
    expect(dayWindow('30d', NOW)).toEqual({ from: '2026-10-05', to: '2026-11-03' });
    expect(dayWindow('90d', NOW)?.from).toBe('2026-08-06');
  });

  test('all time is unbounded', () => {
    expect(dayWindow('all', NOW)).toBeNull();
  });

  test('a valid custom pair is inclusive, and an invalid one falls back to 30d', () => {
    expect(dayWindow('custom', NOW, { from: '2026-01-02', to: '2026-01-09' })).toEqual({
      from: '2026-01-02',
      to: '2026-01-09',
    });
    expect(dayWindow('custom', NOW, { from: '2026-01-09', to: '2026-01-02' })).toEqual({
      from: '2026-10-05',
      to: '2026-11-03',
    });
    expect(dayWindow('custom', NOW, { from: 'nope', to: '2026-01-02' })).toEqual({
      from: '2026-10-05',
      to: '2026-11-03',
    });
  });
});

describe('labels', () => {
  test('a day label is short and a single-day range names its year', () => {
    expect(dayLabel('2026-11-03')).toBe('Nov 3');
    expect(dayRangeLabel('2026-11-03', '2026-11-03', NOW)).toBe('Nov 3, 2026');
  });

  test('a multi-day range prints both sides, omitting this year on the left', () => {
    expect(dayRangeLabel('2026-10-05', '2026-11-03', NOW)).toBe('Oct 5 – Nov 3, 2026');
    expect(dayRangeLabel('2025-12-01', '2026-01-02', NOW)).toBe('Dec 1, 2025 – Jan 2, 2026');
  });

  test('the picker lists one period per span, each with the dates it covers', () => {
    const options = timeRangeOptions(NOW);
    expect(options.map((option) => option.id)).toEqual(['today', '7d', '30d', '90d', 'all', 'custom']);
    // Day/Week/Month ARE the spans: there is no separate cadence control.
    expect(options.map((option) => option.label)).toEqual(['Day', 'Week', 'Month', '90 days', 'All time', 'Custom…']);
    expect(options[0].dateRange).toBe('Nov 3, 2026');
    expect(options[1].dateRange).toBe('Oct 28 – Nov 3, 2026');
    expect(options[2].dateRange).toBe('Oct 5 – Nov 3, 2026');
    expect(options[4].dateRange).toBe('All time');
  });
});

describe('daysInWindow', () => {
  test('enumerates every calendar day of the span, oldest first', () => {
    expect(daysInWindow({ from: '2026-10-28', to: '2026-11-03' })).toHaveLength(7);
    expect(daysInWindow({ from: '2026-10-28', to: '2026-11-03' })[0]).toBe('2026-10-28');
    expect(daysInWindow({ from: '2026-10-28', to: '2026-11-03' }).at(-1)).toBe('2026-11-03');
    // One day, not zero and not two.
    expect(daysInWindow({ from: '2026-11-03', to: '2026-11-03' })).toEqual(['2026-11-03']);
  });

  test('a month crosses the month boundary without losing a day', () => {
    const days = daysInWindow({ from: '2026-10-05', to: '2026-11-03' });
    expect(days).toHaveLength(30);
    expect(days).toContain('2026-10-31');
    expect(days).toContain('2026-11-01');
  });

  test('an inverted or unparseable window yields no days, and a cap bounds it', () => {
    expect(daysInWindow({ from: '2026-11-03', to: '2026-10-01' })).toEqual([]);
    expect(daysInWindow({ from: 'nope', to: '2026-11-03' })).toEqual([]);
    expect(daysInWindow({ from: '2026-01-01', to: '2026-12-31' }, 10)).toHaveLength(10);
  });
});

describe('spanOfDays', () => {
  test('is the first and last recorded day, in either input order', () => {
    expect(spanOfDays(['2026-11-03', '2026-06-24', '2026-09-01'])).toEqual({ from: '2026-06-24', to: '2026-11-03' });
  });

  test('empty and undated input yield no span', () => {
    expect(spanOfDays([])).toBeNull();
    expect(spanOfDays(['', ''])).toBeNull();
  });
});

describe('granularityFor', () => {
  test('follows the period length, so the chart stays readable', () => {
    expect(granularityFor('today')).toBe('day');
    expect(granularityFor('7d')).toBe('day');
    expect(granularityFor('30d')).toBe('day');
    expect(granularityFor('90d')).toBe('week');
    expect(granularityFor('all')).toBe('month');
  });

  test('a custom span picks its width from the span itself', () => {
    expect(granularityFor('custom', { from: '2026-11-01', to: '2026-11-10' })).toBe('day');
    expect(granularityFor('custom', { from: '2026-09-01', to: '2026-11-03' })).toBe('week');
    expect(granularityFor('custom', { from: '2025-01-01', to: '2026-11-03' })).toBe('month');
    // An incomplete custom pair is not a span yet.
    expect(granularityFor('custom', { from: 'nope', to: '2026-11-03' })).toBe('day');
  });
});

describe('bucketKey', () => {
  test('day keeps the day', () => {
    expect(bucketKey('2026-11-03', 'day')).toBe('2026-11-03');
  });

  test('week aligns to Monday', () => {
    // 2026-11-03 is a Tuesday; its Monday is 2026-11-02.
    expect(new Date(2026, 10, 3).getDay()).toBe(2);
    expect(bucketKey('2026-11-03', 'week')).toBe('2026-11-02');
    expect(bucketKey('2026-11-02', 'week')).toBe('2026-11-02');
    // A Sunday belongs to the week that STARTED six days earlier.
    expect(bucketKey('2026-11-08', 'week')).toBe('2026-11-02');
  });

  test('month keeps the year and month', () => {
    expect(bucketKey('2026-11-03', 'month')).toBe('2026-11');
  });

  test('bucket labels follow the granularity', () => {
    expect(bucketLabel('2026-11', 'month')).toBe('Nov');
    expect(bucketLabel('2025-11', 'month')).toBe('Nov 2025');
    expect(bucketLabel('2026-11-02', 'week')).toBe('Nov 2');
  });

  test('day keys sort lexicographically', () => {
    expect(['2026-11-03', '2026-10-05'].sort(compareDayKeys)).toEqual(['2026-10-05', '2026-11-03']);
  });
});
