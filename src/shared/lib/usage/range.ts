/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Day arithmetic for the Token Usage surface: which days a range covers, what
 * a day is called, and how days bucket into weeks and months.
 *
 * Shared deliberately. The SERVER decides which rows a period includes and the
 * CLIENT re-buckets those same rows for the chart and the time tab, so two
 * copies of "what is a week" would draw a chart that disagrees with the table
 * beside it.
 *
 * **A period is a period.** Day / Week / Month / 90 days / All time / Custom are
 * one list of trailing spans, not a grouping choice: every figure in the panel
 * is the total for the selected span. The only derived thing is how those rows
 * are bucketed for the chart, and that follows the period's own length.
 *
 * Every day is a LOCAL calendar day (`YYYY-MM-DD` in the server's timezone),
 * never the UTC prefix of the timestamp. The panel's "Today" is the day the
 * user is in; deriving buckets from the UTC prefix sent a 00:30 WIB record to
 * yesterday's column while the totals counted it in today's.
 */

import type { BucketGranularity, TimeRangeOption, TimeRangeType } from '@/shared/types';

/** Every range the Tokens endpoint answers for, in display order. */
export type PresetTimeRange = Exclude<TimeRangeType, 'custom'>;
export const PRESET_RANGES: readonly PresetTimeRange[] = ['today', '7d', '30d', '90d', 'all'];

const DAY_MS = 24 * 60 * 60 * 1000;
/** Calendar days covered by each trailing preset, today included. */
const PRESET_DAYS: Record<'7d' | '30d' | '90d', number> = { '7d': 7, '30d': 30, '90d': 90 };

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/** `YYYY-MM-DD` of an instant in LOCAL time. */
export function localDayKey(ms: number): string {
  const date = new Date(ms);
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/**
 * The local day of an omp entry timestamp, or `''` when it carries none.
 *
 * `''` rather than `undefined` because the rollup's day column is part of its
 * primary key: SQLite treats NULLs as distinct, so two dateless records for
 * one session would both INSERT instead of accumulating into one row.
 */
export function dayKeyOfTimestamp(timestamp: string | undefined): string {
  if (!timestamp) return '';
  const ms = Date.parse(timestamp);
  return Number.isNaN(ms) ? '' : localDayKey(ms);
}

/** A half-open-free string window: `''` on either side means unbounded. */
export interface DayWindow {
  from: string;
  to: string;
}

/** Validate a `YYYY-MM-DD` query parameter, rejecting impossible dates. */
export function parseIsoDay(value: string): string | null {
  if (!ISO_DAY.test(value)) return null;
  const ms = Date.parse(`${value}T00:00:00`);
  if (Number.isNaN(ms)) return null;
  return localDayKey(ms) === value ? value : null;
}

/**
 * The days a range covers. `null` means "every day" (all time).
 *
 * Trailing presets count CALENDAR days with today included — "Last 7 days" is
 * today plus the six before it, which is what the tab promises and what the
 * chart's first/last labels then show.
 */
export function dayWindow(
  range: TimeRangeType,
  now: number,
  custom?: { from?: string | null; to?: string | null },
): DayWindow | null {
  if (range === 'custom') {
    const from = custom?.from ? parseIsoDay(custom.from) : null;
    const to = custom?.to ? parseIsoDay(custom.to) : null;
    if (from && to && from <= to) return { from, to };
    return trailingWindow('30d', now);
  }
  if (range === 'all') return null;
  if (range === 'today') {
    const today = localDayKey(now);
    return { from: today, to: today };
  }
  return trailingWindow(range, now);
}

function trailingWindow(range: '7d' | '30d' | '90d', now: number): DayWindow {
  const days = PRESET_DAYS[range];
  return { from: localDayKey(now - (days - 1) * DAY_MS), to: localDayKey(now) };
}

/** Short day label: `2026-11-03` → `Nov 3`. */
export function dayLabel(dayKey: string): string {
  if (!dayKey) return 'Undated';
  const date = new Date(`${dayKey}T00:00:00`);
  return Number.isNaN(date.getTime()) ? dayKey : `${MONTH_LABELS[date.getMonth()]} ${date.getDate()}`;
}

/** `from`/`to` as one human range; a same-day window collapses to that day. */
export function dayRangeLabel(from: string, to: string, now: number = Date.now()): string {
  if (!from || !to) return 'All time';
  if (from === to) return `${dayLabel(from)}, ${new Date(`${from}T00:00:00`).getFullYear()}`;
  const thisYear = new Date(now).getFullYear();
  const fromYear = new Date(`${from}T00:00:00`).getFullYear();
  const toYear = new Date(`${to}T00:00:00`).getFullYear();
  const left = fromYear === thisYear ? dayLabel(from) : `${dayLabel(from)}, ${fromYear}`;
  const right = `${dayLabel(to)}, ${toYear}`;
  return `${left} – ${right}`;
}

/**
 * The bucket a day folds into: the day itself, its Monday, or `YYYY-MM`.
 * Monday alignment is ISO-8601's week, which is also what a "week" row means to
 * the reader.
 */
export function bucketKey(dayKey: string, granularity: BucketGranularity): string {
  if (granularity === 'month') return dayKey.slice(0, 7);
  if (granularity === 'week') {
    const date = new Date(`${dayKey}T00:00:00`);
    if (Number.isNaN(date.getTime())) return dayKey;
    const monday = new Date(date);
    monday.setDate(date.getDate() - ((date.getDay() + 6) % 7));
    return localDayKey(monday.getTime());
  }
  return dayKey;
}

/** Label for a bucket key, matching the granularity that produced it. */
export function bucketLabel(key: string, granularity: BucketGranularity): string {
  if (granularity === 'month') {
    const [year, month] = key.split('-');
    const label = MONTH_LABELS[Number(month) - 1] ?? key;
    const fullYear = Number(year);
    return Number.isFinite(fullYear) && fullYear !== new Date().getFullYear() ? `${label} ${year}` : label;
  }
  return dayLabel(key);
}

/**
 * The period picker's entries, each with the dates it covers.
 *
 * Day / Week / Month name the SPAN (today, the last 7 days, the last 30), which
 * is why there is no separate daily/weekly/monthly control: choosing Month and
 * choosing "Last 30 days" are the same act.
 */
export function timeRangeOptions(now: number = Date.now()): TimeRangeOption[] {
  const option = (id: TimeRangeType, label: string): TimeRangeOption => {
    const window = dayWindow(id, now);
    return { id, label, dateRange: window ? dayRangeLabel(window.from, window.to, now) : 'All time' };
  };
  return [
    option('today', 'Day'),
    option('7d', 'Week'),
    option('30d', 'Month'),
    option('90d', '90 days'),
    option('all', 'All time'),
    { id: 'custom', label: 'Custom…', dateRange: 'Custom period' },
  ];
}

/**
 * How the period's rows are bucketed for the chart and the time tab.
 *
 * Follows the period's own length, so the picture stays readable without
 * asking the user a second question: a day or a month draws days, a quarter
 * draws weeks, a long custom span or all time draws months.
 */
export function granularityFor(range: TimeRangeType, custom?: { from?: string; to?: string }): BucketGranularity {
  if (range === 'today' || range === '7d' || range === '30d') return 'day';
  if (range === '90d') return 'week';
  if (range === 'all') return 'month';
  const from = custom?.from ? parseIsoDay(custom.from) : null;
  const to = custom?.to ? parseIsoDay(custom.to) : null;
  if (!from || !to) return 'day';
  const days = Math.round((Date.parse(`${to}T00:00:00`) - Date.parse(`${from}T00:00:00`)) / DAY_MS) + 1;
  if (days <= 31) return 'day';
  if (days <= 120) return 'week';
  return 'month';
}

/**
 * Every day in a window, oldest first.
 *
 * The rollup only stores days that HAVE usage, so a day with no work is absent
 * from the payload — and a time table built from those rows silently omits it.
 * The panel promises the PERIOD, so the range's own days are what it lists.
 * Capped so an all-time range cannot build a decade of rows.
 */
export function daysInWindow(window: DayWindow, cap = 400): string[] {
  const start = Date.parse(`${window.from}T00:00:00`);
  const end = Date.parse(`${window.to}T00:00:00`);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return [];
  const days: string[] = [];
  for (let at = start; at <= end && days.length < cap; at += DAY_MS) {
    // DST-safe: the key is recomputed from the local calendar, never by adding
    // 86 400 000 ms to a formatted string.
    const day = localDayKey(at);
    if (days[days.length - 1] !== day) days.push(day);
  }
  return days;
}

/**
 * The span a set of day keys covers, or `null` when there are none.
 *
 * All time has no bounded window, but its table still has to list every bucket
 * between the first and last recorded day — otherwise a quiet month in the
 * middle of the history disappears and the rows stop adding up to the totals
 * shown beside them.
 */
export function spanOfDays(dayKeys: Iterable<string>): DayWindow | null {
  let from = '';
  let to = '';
  for (const day of dayKeys) {
    if (!day) continue;
    if (!from || day < from) from = day;
    if (!to || day > to) to = day;
  }
  return from && to ? { from, to } : null;
}

/** Sort helper for day keys (`YYYY-MM-DD` sorts lexicographically). */
export function compareDayKeys(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
