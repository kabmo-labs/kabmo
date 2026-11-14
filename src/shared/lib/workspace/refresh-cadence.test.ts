/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Pins the two time-shaped contracts Kabmo reasons about everywhere.
 *
 * `refresh-cadence.ts` is the single table every poll/throttle reads, so a
 * value drifting (or two related values crossing) changes how often the app
 * touches disk and network. The retry schedule's length, monotonicity and sum
 * are what the spawn-wait budget is documented as.
 *
 * `relativeTimeAgo` is the only place a sidebar row's age is rendered, so each
 * bucket boundary and the year cutoff are pinned rather than the implementation.
 */

import { describe, expect, test } from 'bun:test';

import {
  BROWSER_POLL_MS,
  SESSION_META_RETRY_SCHEDULE_MS,
  SIDEBAR_DATA_TTL_MS,
  STREAM_HEARTBEAT_MS,
} from '@/shared/lib/workspace/refresh-cadence';
import { formatFullDate, formatRunElapsed, relativeTimeAgo } from '@/shared/lib/workspace/relative-time';

describe('refresh cadences', () => {
  test('the documented millisecond values', () => {
    expect(BROWSER_POLL_MS).toBe(1_000);
    expect(STREAM_HEARTBEAT_MS).toBe(30_000);
  });

  test('the sidebar dataset TTL stays short', () => {
    // The sidebar rides the realtime socket, so nothing polls this cache; the
    // TTL only dedupes concurrent resolves of one publish burst, and a
    // structure publish invalidates it outright.
    expect(SIDEBAR_DATA_TTL_MS).toBe(4_000);
  });

  test('the spawn retry schedule is front-loaded, non-decreasing and finite', () => {
    const schedule = SESSION_META_RETRY_SCHEDULE_MS;
    expect(schedule).toHaveLength(12);
    expect(schedule[0]).toBe(250);
    for (let i = 1; i < schedule.length; i++) {
      expect(schedule[i]).toBeGreaterThanOrEqual(schedule[i - 1]);
    }
    // Documented budget: 13 attempts over ~15.5s.
    const total = schedule.reduce((sum, delay) => sum + delay, 0);
    expect(total).toBe(15_500);
    expect(schedule.length + 1).toBe(13);
  });
});

describe('relativeTimeAgo', () => {
  const now = Date.UTC(2026, 0, 15, 12, 0, 0);
  const ago = (ms: number): string | null => relativeTimeAgo(now - ms, now);

  const SECOND = 1_000;
  const MINUTE = 60 * SECOND;
  const HOUR = 60 * MINUTE;
  const DAY = 24 * HOUR;

  test('missing or unparseable input yields null', () => {
    expect(relativeTimeAgo(null, now)).toBeNull();
    expect(relativeTimeAgo(undefined, now)).toBeNull();
    expect(relativeTimeAgo('', now)).toBeNull();
    expect(relativeTimeAgo('not a date', now)).toBeNull();
  });

  test('a future timestamp still reads as now', () => {
    expect(relativeTimeAgo(now + 5 * MINUTE, now)).toBe('now');
  });

  test('the sub-minute bucket covers up to 44s', () => {
    expect(ago(0)).toBe('now');
    expect(ago(30 * SECOND)).toBe('now');
    expect(ago(44 * SECOND)).toBe('now');
  });

  test('minute/hour/day/week buckets at their boundaries', () => {
    expect(ago(45 * SECOND)).toBe('1m');
    expect(ago(59 * SECOND)).toBe('1m');
    expect(ago(30 * MINUTE)).toBe('30m');
    expect(ago(59 * MINUTE)).toBe('59m');
    expect(ago(HOUR)).toBe('1h');
    expect(ago(23 * HOUR)).toBe('23h');
    expect(ago(DAY)).toBe('1d');
    expect(ago(6 * DAY)).toBe('6d');
    expect(ago(7 * DAY)).toBe('1w');
    expect(ago(28 * DAY)).toBe('4w');
  });

  test('past five weeks it falls back to a calendar date', () => {
    // 35 days before 2026-01-15 is 2025-12-11: same-year? No — a different
    // year, so the year is appended.
    expect(ago(35 * DAY)).toBe('11 Dec 2025');
    // 56 days before is 2025-11-20, still a different year.
    expect(ago(56 * DAY)).toBe('20 Nov 2025');
  });

  test('a same-year date older than five weeks omits the year', () => {
    const later = Date.UTC(2026, 8, 30, 12, 0, 0);
    expect(relativeTimeAgo(Date.UTC(2026, 2, 3, 6, 0, 0), later)).toBe('3 Mar');
  });

  test('parses an ISO string the same as its epoch millis', () => {
    const iso = '2026-01-15T11:30:00.000Z';
    expect(relativeTimeAgo(iso, now)).toBe(relativeTimeAgo(Date.parse(iso), now));
    expect(relativeTimeAgo(iso, now)).toBe('30m');
  });

  test('defaults `now` to the wall clock', () => {
    expect(relativeTimeAgo(Date.now(), Date.now())).toBe('now');
    expect(relativeTimeAgo(Date.now() - 5 * MINUTE)).toBe('5m');
  });
});

describe('formatFullDate', () => {
  test('missing or unparseable input yields null', () => {
    expect(formatFullDate(null)).toBeNull();
    expect(formatFullDate(undefined)).toBeNull();
    expect(formatFullDate('')).toBeNull();
    expect(formatFullDate('not a date')).toBeNull();
  });

  test('renders the full weekday, date and clock', () => {
    // 2026-11-12T14:30:00Z — the exact local rendering depends on the test
    // machine's zone, so assert the parts that do not.
    const label = formatFullDate('2026-11-12T14:30:00.000Z');
    expect(label).toContain('Nov');
    expect(label).toContain('2026');
    expect(label).toContain('12');
    expect(label).toMatch(/\d{1,2}:\d{2}/);
  });

  test('parses an ISO string the same as its epoch millis', () => {
    const iso = '2026-01-15T11:30:00.000Z';
    expect(formatFullDate(iso)).toBe(formatFullDate(Date.parse(iso)));
  });
});

describe('formatRunElapsed', () => {
  const SECOND = 1_000;
  const MINUTE = 60 * SECOND;
  const HOUR = 60 * MINUTE;

  test('a live clock starts at 0s, never blank or negative', () => {
    expect(formatRunElapsed(0)).toBe('0s');
    expect(formatRunElapsed(999)).toBe('0s');
    expect(formatRunElapsed(-5_000)).toBe('0s');
    expect(formatRunElapsed(Number.NaN)).toBe('0s');
  });

  test('seconds below a minute', () => {
    expect(formatRunElapsed(SECOND)).toBe('1s');
    expect(formatRunElapsed(59 * SECOND)).toBe('59s');
  });

  test('minutes keep their seconds', () => {
    expect(formatRunElapsed(MINUTE)).toBe('1m 0s');
    expect(formatRunElapsed(83 * SECOND)).toBe('1m 23s');
    expect(formatRunElapsed(59 * MINUTE + 59 * SECOND)).toBe('59m 59s');
  });

  test('seconds are dropped once the run is an hour old', () => {
    // The row's slot is narrow and a second digit past the hour is motion
    // without information; the minute is the useful unit there.
    expect(formatRunElapsed(HOUR)).toBe('1h 0m');
    expect(formatRunElapsed(HOUR + 5 * SECOND)).toBe('1h 0m');
    expect(formatRunElapsed(HOUR + 4 * MINUTE + 59 * SECOND)).toBe('1h 4m');
    expect(formatRunElapsed(26 * HOUR + 3 * MINUTE)).toBe('26h 3m');
  });
});
