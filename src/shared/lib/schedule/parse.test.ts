/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The schedule grammar, pinned where it is easy to get wrong.
 *
 * Three rules carry real risk and each is asserted directly:
 *
 * - the DOM/DOW OR rule (Vixie cron) — `0 0 13 * 5` fires on the 13th AND on
 *   every Friday, not only on Friday the 13th;
 * - `nextCronOccurrence` is strictly AFTER the cursor, so a task firing at
 *   exactly its own `lastRunAt` advances instead of re-firing forever;
 * - an impossible date (`0 0 30 2 *`) reports "never" rather than hanging the
 *   day walk.
 *
 * Every date is built in LOCAL time — the runtime fires on local wall-clock,
 * and a UTC-built expectation would pass in one timezone and fail in another.
 */

import { describe, expect, test } from 'bun:test';
import {
  describeSchedule,
  formatDuration,
  nextCronOccurrence,
  nextRunAfter,
  parseCron,
  parseInterval,
  parseOnce,
  validateSchedule,
} from '@/shared/lib/schedule/parse';

describe('parseInterval', () => {
  test('accepts compact and spaced spellings', () => {
    expect(parseInterval('30s')).toBe(30_000);
    expect(parseInterval('5m')).toBe(300_000);
    expect(parseInterval('1h30m')).toBe(5_400_000);
    expect(parseInterval('1 h 30 m')).toBe(5_400_000);
    expect(parseInterval('5 mins')).toBe(300_000);
    expect(parseInterval('2 hours')).toBe(7_200_000);
    expect(parseInterval('1 day')).toBe(86_400_000);
    expect(parseInterval('1w')).toBe(604_800_000);
  });

  test('a bare number means minutes', () => {
    expect(parseInterval('15')).toBe(900_000);
  });

  test('rejects junk, zero and trailing garbage', () => {
    expect(parseInterval('')).toBeNull();
    expect(parseInterval('0m')).toBeNull();
    expect(parseInterval('soon')).toBeNull();
    expect(parseInterval('5m x')).toBeNull();
    expect(parseInterval('5 fortnights')).toBeNull();
  });
});

describe('parseCron', () => {
  test('expands stars, ranges, lists and steps', () => {
    const fields = parseCron('*/15 9-17 * * 1,3,5');
    expect(fields).not.toBeNull();
    expect(fields?.minutes).toEqual([0, 15, 30, 45]);
    expect(fields?.hours).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 17]);
    expect(fields?.daysOfWeek).toEqual([1, 3, 5]);
    expect(fields?.domRestricted).toBe(false);
    expect(fields?.dowRestricted).toBe(true);
  });

  test('`5/15` means from 5, every 15', () => {
    expect(parseCron('5/15 * * * *')?.minutes).toEqual([5, 20, 35, 50]);
  });

  test('Sunday is 0 or 7', () => {
    expect(parseCron('0 0 * * 7')?.daysOfWeek).toEqual([0]);
    expect(parseCron('0 0 * * 0,7')?.daysOfWeek).toEqual([0]);
  });

  test('rejects the wrong field count and out-of-range values', () => {
    expect(parseCron('0 9 * *')).toBeNull();
    expect(parseCron('60 9 * * *')).toBeNull();
    expect(parseCron('0 24 * * *')).toBeNull();
    expect(parseCron('0 0 0 * *')).toBeNull();
    expect(parseCron('0 0 * 13 *')).toBeNull();
    expect(parseCron('0 0 * * 8')).toBeNull();
    expect(parseCron('*/0 * * * *')).toBeNull();
    expect(parseCron('9-5 * * * *')).toBeNull();
  });
});

describe('nextCronOccurrence', () => {
  const at = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi, 0, 0);

  test('finds the next matching minute strictly after the cursor', () => {
    const fields = parseCron('0 9 * * *');
    // Exactly at 09:00 the next fire is tomorrow, not the same minute.
    expect(nextCronOccurrence(fields!, at(2026, 3, 2, 9, 0))).toBe(at(2026, 3, 3, 9, 0).getTime());
    expect(nextCronOccurrence(fields!, at(2026, 3, 2, 8, 59))).toBe(at(2026, 3, 2, 9, 0).getTime());
  });

  test('both DOM and DOW restricted: a day matches if EITHER does', () => {
    // March 2026: the 13th is a Friday. Every Friday must also fire.
    const fields = parseCron('0 12 13 * 5')!;
    expect(nextCronOccurrence(fields, at(2026, 3, 10))).toBe(at(2026, 3, 13, 12, 0).getTime());
    // From the 14th (Saturday) the next hit is the following Friday, not April.
    expect(nextCronOccurrence(fields, at(2026, 3, 14))).toBe(at(2026, 3, 20, 12, 0).getTime());
  });

  test('a month-excluded schedule skips whole months', () => {
    const fields = parseCron('0 0 1 6 *')!;
    expect(nextCronOccurrence(fields, at(2026, 3, 15))).toBe(at(2026, 6, 1).getTime());
  });

  test('Feb 29 resolves years ahead instead of walking minutes', () => {
    const fields = parseCron('0 0 29 2 *')!;
    expect(nextCronOccurrence(fields, at(2026, 1, 1))).toBe(at(2028, 2, 29).getTime());
  });

  test('an impossible date reports never', () => {
    expect(nextCronOccurrence(parseCron('0 0 30 2 *')!, at(2026, 1, 1))).toBeNull();
  });
});

describe('validateSchedule', () => {
  const now = new Date(2026, 2, 2, 8, 0, 0, 0).getTime();

  test('rejects a one-shot in the past', () => {
    const result = validateSchedule('once', '2020-01-01T00:00:00', now);
    expect(result.ok).toBe(false);
  });

  test('accepts a one-shot in the future and reports its time', () => {
    const result = validateSchedule('once', '2026-10-01T09:00', now);
    expect(result).toEqual({ ok: true, nextRunAt: new Date(2026, 9, 1, 9, 0).getTime() });
  });

  test('enforces the one-minute floor', () => {
    expect(validateSchedule('every', '30s', now).ok).toBe(false);
    const ok = validateSchedule('every', '5m', now);
    expect(ok).toEqual({ ok: true, nextRunAt: now + 300_000 });
  });

  test('rejects an unparseable cron and reports the next hit for a valid one', () => {
    expect(validateSchedule('cron', 'nonsense', now).ok).toBe(false);
    const ok = validateSchedule('cron', '30 8 * * *', now);
    expect(ok).toEqual({ ok: true, nextRunAt: new Date(2026, 2, 2, 8, 30).getTime() });
  });
});

describe('nextRunAfter', () => {
  test('a one-shot is spent', () => {
    expect(nextRunAfter('once', '2026-10-01T09:00', Date.now())).toBeNull();
  });

  test('an interval advances from the fire it just made, not from now', () => {
    expect(nextRunAfter('every', '1h', 1_000_000)).toBe(1_000_000 + 3_600_000);
  });

  test('a cron advances to the following occurrence', () => {
    const base = new Date(2026, 2, 2, 9, 0).getTime();
    expect(nextRunAfter('cron', '0 9 * * *', base)).toBe(new Date(2026, 2, 3, 9, 0).getTime());
  });
});

describe('describeSchedule / formatDuration', () => {
  test('formats a duration with its two largest units', () => {
    expect(formatDuration(90_000)).toBe('1m 30s');
    expect(formatDuration(5_400_000)).toBe('1h 30m');
    expect(formatDuration(90_000_000)).toBe('1d 1h');
    expect(formatDuration(500)).toBe('1s');
  });

  test('summarizes each kind', () => {
    expect(describeSchedule('every', '5m')).toBe('Every 5m');
    expect(describeSchedule('cron', '0 9 * * *')).toBe('Cron 0 9 * * *');
    expect(describeSchedule('once', '2026-10-01T09:00')).toContain('Once at');
  });
});

describe('parseOnce', () => {
  test('accepts ISO and epoch, rejects junk', () => {
    expect(parseOnce('2026-10-01T09:00')).toBe(new Date(2026, 9, 1, 9, 0).getTime());
    expect(parseOnce('1770000000000')).toBe(1_770_000_000_000);
    expect(parseOnce('')).toBeNull();
    expect(parseOnce('tomorrow')).toBeNull();
  });
});
