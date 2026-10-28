/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Time formatting for the chat timeline.
 *
 * The live stream sends a preformatted "Today, 10:30 AM" label that `new Date()`
 * cannot parse, so `parseTodayLabel` resolves it against the CURRENT day and
 * `formatMessageStamp` has to route three shapes correctly: an already-"Today,"
 * label, a bare clock time, and a historical date. A wrong route shows the wrong
 * day, which is exactly the class of bug this module exists to prevent.
 * `formatTimestamp` is a best-effort tool-detail stamp: numbers go through the
 * runtime's locale clock, strings pass through, and anything else is empty —
 * it must never invent an ISO date.
 *
 * All dates here are built from local components (or ISO strings without a zone,
 * which JS parses as local), so the assertions hold in any timezone.
 */

import { describe, expect, test } from 'bun:test';

import { formatClock, formatMessageStamp, formatTimestamp, parseTodayLabel } from '@/shared/lib/format/time';

describe('formatClock', () => {
  test('renders a 12-hour clock with a zero-padded hour', () => {
    expect(formatClock(new Date(2026, 0, 1, 14, 5))).toBe('02:05 PM');
    expect(formatClock(new Date(2026, 0, 1, 9, 7))).toBe('09:07 AM');
  });

  test('midnight and noon use 12', () => {
    expect(formatClock(new Date(2026, 0, 1, 0, 0))).toBe('12:00 AM');
    expect(formatClock(new Date(2026, 0, 1, 12, 0))).toBe('12:00 PM');
  });

  test('accepts an epoch-ms number', () => {
    expect(formatClock(new Date(2026, 0, 1, 9, 7).getTime())).toBe('09:07 AM');
  });
});

describe('parseTodayLabel', () => {
  test('resolves a Today label against the current local day', () => {
    const ms = parseTodayLabel('Today, 10:30 AM');
    expect(ms).not.toBeNull();
    const parsed = new Date(ms as number);
    expect(parsed.getHours()).toBe(10);
    expect(parsed.getMinutes()).toBe(30);
    expect(parsed.toDateString()).toBe(new Date().toDateString());
  });

  test('rejects anything that is not a Today label', () => {
    expect(parseTodayLabel('Yesterday, 10:30 AM')).toBeNull();
    expect(parseTodayLabel('2026-01-01')).toBeNull();
  });

  test('rejects a Today label whose time part cannot be parsed', () => {
    expect(parseTodayLabel('Today, not a time')).toBeNull();
    expect(parseTodayLabel('Today, 25:99')).toBeNull();
  });
});

describe('formatMessageStamp', () => {
  test('is empty without a timestamp or date', () => {
    expect(formatMessageStamp()).toBe('');
    expect(formatMessageStamp({})).toBe('');
  });

  test('prefers the timestamp over the date', () => {
    expect(formatMessageStamp({ timestamp: '2026-01-02T03:04:00', date: '2026-01-01T00:00:00' })).toBe(
      'Jan 2, 03:04 AM',
    );
  });

  test('falls back to the date field', () => {
    expect(formatMessageStamp({ date: '2026-01-02T03:04:00' })).toBe('Jan 2, 03:04 AM');
  });

  test('normalizes an already-Today label', () => {
    expect(formatMessageStamp({ timestamp: 'Today, 10:30 AM' })).toBe('Today, 10:30 AM');
    expect(formatMessageStamp({ timestamp: 'Today,10:30 AM' })).toBe('Today, 10:30 AM');
  });

  test('resolves a bare clock time against today', () => {
    expect(formatMessageStamp({ timestamp: '10:30 AM' })).toBe('Today, 10:30 AM');
    expect(formatMessageStamp({ timestamp: '3:05 pm' })).toBe('Today, 03:05 PM');
  });

  test('an unparseable value is empty', () => {
    expect(formatMessageStamp({ timestamp: 'not a date' })).toBe('');
  });
});

describe('formatTimestamp', () => {
  test('renders an epoch-ms value as a locale clock time, not an ISO date', () => {
    const result = formatTimestamp(new Date(2026, 0, 1, 14, 5).getTime());
    expect(result).toMatch(/:/);
    expect(result).not.toMatch(/[T-]/);
  });

  test('passes a string through unchanged', () => {
    expect(formatTimestamp('10:30')).toBe('10:30');
  });

  test('is empty for invalid numbers and non-string, non-number values', () => {
    expect(formatTimestamp(Number.NaN)).toBe('');
    expect(formatTimestamp(Number.POSITIVE_INFINITY)).toBe('');
    expect(formatTimestamp(null)).toBe('');
    expect(formatTimestamp(undefined)).toBe('');
    expect(formatTimestamp(true)).toBe('');
    expect(formatTimestamp({})).toBe('');
  });
});
