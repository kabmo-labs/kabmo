/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Schedule-expression parsing, shared by the modal (inline validation and the
 * "next run" preview) and the server runtime (when the next fire is due).
 *
 * Two grammars, both deliberately small:
 *
 * - `every` — a duration: `30s`, `5m`, `1h30m`, `2d`, `1w`, and the human
 *   spellings `5 mins`, `2 hours`, `1 day`. Compact units may be concatenated
 *   (`1h30m`); a bare number means minutes.
 * - `cron`  — 5 fields (`min hour dom month dow`) with `*`, `N`, `a-b`,
 *   `a,b,c`, star-slash-n and `a-b/n`. Day-of-week is 0-7, both 0 and 7 being
 *   Sunday.
 *   When BOTH day-of-month and day-of-week are restricted, a day matches if
 *   either does — Vixie cron's rule, which is what every other scheduler's
 *   users expect and what a naive AND would silently get wrong.
 *
 * `nextCronOccurrence` walks DAYS rather than minutes: a `0 0 29 2 *` (Feb 29)
 * is 1461 minutes-free day steps away, while a minute walk would be 2.1 M
 * iterations. Months are skipped whole when the month field excludes them.
 */

import type { ScheduleKind } from '@/shared/types/schedule';
import { isValidTimeZone, serverTimeZone, wallClock, wallTimeToInstant } from '@/shared/lib/schedule/timezone';

/** Shortest interval the runtime can honour: it ticks once a minute. */
export const MIN_INTERVAL_MS = 60_000;


const UNIT_MS: Record<string, number> = {
  s: 1_000,
  sec: 1_000,
  secs: 1_000,
  second: 1_000,
  seconds: 1_000,
  m: 60_000,
  min: 60_000,
  mins: 60_000,
  minute: 60_000,
  minutes: 60_000,
  h: 3_600_000,
  hr: 3_600_000,
  hrs: 3_600_000,
  hour: 3_600_000,
  hours: 3_600_000,
  d: 86_400_000,
  day: 86_400_000,
  days: 86_400_000,
  w: 604_800_000,
  week: 604_800_000,
  weeks: 604_800_000,
};

/**
 * Parse an interval expression to milliseconds, or null when it is not one.
 *
 * Accepts the compact and the spaced spelling, mixed: `1h30m`, `1 h 30 m`,
 * `5 mins`, `2 days`. A bare number is minutes, which is what the modal's
 * placeholder implies.
 */
export function parseInterval(spec: string): number | null {
  const text = spec.trim().toLowerCase();
  if (!text) return null;
  if (/^\d+(\.\d+)?$/.test(text)) {
    const minutes = Number(text);
    return minutes > 0 ? Math.round(minutes * 60_000) : null;
  }
  const parts = text.match(/(\d+(?:\.\d+)?)\s*([a-z]+)/g);
  if (!parts) return null;
  // The whole string must be consumed by unit parts, or `5m x` would parse.
  const consumed = parts.join('').replace(/\s+/g, '');
  if (consumed.length !== text.replace(/\s+/g, '').length) return null;
  let total = 0;
  for (const part of parts) {
    const match = part.match(/^(\d+(?:\.\d+)?)\s*([a-z]+)$/);
    if (!match) return null;
    const unit = UNIT_MS[match[2]];
    if (!unit) return null;
    total += Number(match[1]) * unit;
  }
  return total > 0 ? Math.round(total) : null;
}

export interface CronFields {
  minutes: number[];
  hours: number[];
  daysOfMonth: number[];
  months: number[];
  daysOfWeek: number[];
  /** True when the field was written `*` — the OR rule keys off this. */
  domRestricted: boolean;
  dowRestricted: boolean;
}

const CRON_BOUNDS: [number, number][] = [
  [0, 59], // minute
  [0, 23], // hour
  [1, 31], // day of month
  [1, 12], // month
  [0, 7], // day of week
];

function parseCronField(field: string, min: number, max: number): number[] | null {
  const values = new Set<number>();
  for (const chunk of field.split(',')) {
    const [rangePart, stepPart] = chunk.split('/');
    const step = stepPart === undefined ? 1 : Number(stepPart);
    if (!Number.isInteger(step) || step < 1) return null;

    let start: number;
    let end: number;
    if (rangePart === '*') {
      start = min;
      end = max;
    } else if (rangePart.includes('-')) {
      const [a, b] = rangePart.split('-');
      start = Number(a);
      end = Number(b);
    } else {
      start = Number(rangePart);
      // `5/15` means "from 5, every 15" — cron's own meaning.
      end = stepPart === undefined ? start : max;
    }
    if (!Number.isInteger(start) || !Number.isInteger(end)) return null;
    if (start < min || end > max || start > end) return null;
    for (let value = start; value <= end; value += step) values.add(value);
  }
  return values.size ? [...values].sort((a, b) => a - b) : null;
}

/** Parse a 5-field cron expression, or null when it is not one. */
export function parseCron(spec: string): CronFields | null {
  const fields = spec.trim().split(/\s+/);
  if (fields.length !== 5) return null;
  const parsed = fields.map((field, index) => {
    const [min, max] = CRON_BOUNDS[index];
    return parseCronField(field, min, max);
  });
  if (parsed.some((field) => field === null)) return null;
  const [minutes, hours, daysOfMonth, months, daysOfWeek] = parsed as number[][];
  return {
    minutes,
    hours,
    daysOfMonth,
    months,
    // Sunday is spelled 0 or 7; fold so the match test has one value.
    daysOfWeek: [...new Set(daysOfWeek.map((day) => (day === 7 ? 0 : day)))].sort((a, b) => a - b),
    domRestricted: fields[2].trim() !== '*',
    dowRestricted: fields[4].trim() !== '*',
  };
}

function dayMatches(fields: CronFields, year: number, month: number, day: number): boolean {
  const dow = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  const byDom = fields.daysOfMonth.includes(day);
  const byDow = fields.daysOfWeek.includes(dow);
  // Vixie cron: with both fields restricted the day matches if EITHER does.
  if (fields.domRestricted && fields.dowRestricted) return byDom || byDow;
  if (fields.domRestricted) return byDom;
  if (fields.dowRestricted) return byDow;
  return true;
}

/**
 * The first fire strictly after `from`, in the task's zone. Null when the
 * expression never matches inside the horizon (an impossible date such as
 * `0 0 30 2 *`).
 *
 * The walk advances one CALENDAR DAY at a time in the zone's own calendar, and
 * a month the month-field excludes is jumped whole. Advancing by an offset
 * instead would land mid-month after a skip and miss the first of the month it
 * jumped to. Candidate wall times are converted through the zone, so a DST
 * transition neither shifts the fire nor produces a duplicate.
 */
export function nextCronOccurrence(fields: CronFields, from: Date, timeZone?: string): number | null {
  const zone = timeZone && isValidTimeZone(timeZone) ? timeZone : serverTimeZone();
  const start = wallClock(from.getTime(), zone);
  const horizon = Date.UTC(start.year + 8, start.month - 1, start.day);

  for (let dayCursor = Date.UTC(start.year, start.month - 1, start.day); dayCursor <= horizon; ) {
    const date = new Date(dayCursor);
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth() + 1;
    const day = date.getUTCDate();
    if (!fields.months.includes(month)) {
      dayCursor = Date.UTC(year, month, 1);
      continue;
    }
    if (dayMatches(fields, year, month, day)) {
      for (const hour of fields.hours) {
        for (const minute of fields.minutes) {
          const instant = wallTimeToInstant(year, month, day, hour, minute, zone);
          if (instant !== null && instant > from.getTime()) return instant;
        }
      }
    }
    dayCursor = Date.UTC(year, month - 1, day + 1);
  }
  return null;
}

/** A datetime with no offset: its wall time is read in the task's zone. */
const NAIVE_DATETIME = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/;

/**
 * Parse a `once` spec (ISO-8601 timestamp, or epoch ms).
 *
 * A spec that carries an offset (`Z`, `+02:00`) is absolute and is left to
 * `Date.parse`. A naive datetime is a wall-clock statement, so with a zone it
 * is resolved in that zone; without one it keeps `Date.parse`'s local reading.
 */
export function parseOnce(spec: string, timeZone?: string): number | null {
  const text = spec.trim();
  if (!text) return null;
  if (/^\d+$/.test(text)) {
    const ms = Number(text);
    return ms > 0 ? ms : null;
  }
  if (timeZone) {
    const match = text.match(NAIVE_DATETIME);
    if (match) {
      const [, year, month, day, hour, minute, second, fraction] = match;
      const instant = wallTimeToInstant(
        Number(year),
        Number(month),
        Number(day),
        Number(hour),
        Number(minute),
        timeZone,
      );
      if (instant === null) return null;
      const millis = (second ? Number(second) * 1_000 : 0) + (fraction ? Number(fraction.padEnd(3, '0')) : 0);
      return instant + millis;
    }
  }
  const ms = Date.parse(text);
  return Number.isNaN(ms) ? null : ms;
}

export type ScheduleValidation =
  | { ok: true; nextRunAt: number }
  | { ok: false; error: string };

/**
 * Validate a schedule expression and compute its first fire. The single gate
 * both the modal (inline feedback) and the route (a stale client) use, so a
 * row can never be written with a spec the runtime cannot schedule.
 */
export function validateSchedule(
  kind: ScheduleKind,
  spec: string,
  now = Date.now(),
  timeZone?: string,
): ScheduleValidation {
  if (!spec.trim()) return { ok: false, error: 'Enter a schedule.' };
  if (kind === 'once') {
    const at = parseOnce(spec, timeZone);
    if (at === null) return { ok: false, error: 'Use an ISO timestamp, e.g. 2026-10-01T09:00.' };
    if (at <= now) return { ok: false, error: 'That time is already in the past.' };
    return { ok: true, nextRunAt: at };
  }
  if (kind === 'every') {
    const interval = parseInterval(spec);
    if (interval === null) return { ok: false, error: 'Use a duration, e.g. 30m, 1h30m, 2 days.' };
    if (interval < MIN_INTERVAL_MS) return { ok: false, error: 'The shortest interval is 1 minute.' };
    return { ok: true, nextRunAt: now + interval };
  }
  const fields = parseCron(spec);
  if (!fields) {
    return { ok: false, error: 'Use 5 fields: minute hour day-of-month month day-of-week.' };
  }
  const next = nextCronOccurrence(fields, new Date(now), timeZone);
  if (next === null) return { ok: false, error: 'That expression never matches a date.' };
  return { ok: true, nextRunAt: next };
}

/**
 * The fire after `after` for an already-validated task, or null when there is
 * none (a spent `once`). Used by the runtime to advance a task's schedule.
 */
export function nextRunAfter(
  kind: ScheduleKind,
  spec: string,
  after: number,
  timeZone?: string,
): number | null {
  if (kind === 'once') return null;
  if (kind === 'every') {
    const interval = parseInterval(spec);
    return interval === null ? null : after + interval;
  }
  const fields = parseCron(spec);
  return fields ? nextCronOccurrence(fields, new Date(after), timeZone) : null;
}

/** Human summary of a schedule for the task list and the run log. */
export function describeSchedule(kind: ScheduleKind, spec: string, timeZone?: string): string {
  const text = spec.trim();
  if (kind === 'once') {
    const at = parseOnce(text, timeZone);
    return at === null ? text : `Once at ${new Date(at).toLocaleString(undefined, timeZone ? { timeZone } : undefined)}`;
  }
  if (kind === 'every') {
    const interval = parseInterval(text);
    return interval === null ? text : `Every ${formatDuration(interval)}`;
  }
  return `Cron ${text}`;
}

/** `90000` → `1m 30s`; the largest two units are enough to read a cadence. */
export function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const rest = seconds % 60;
  const parts: string[] = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (minutes) parts.push(`${minutes}m`);
  if (rest && !days) parts.push(`${rest}s`);
  return parts.length ? parts.join(' ') : '0s';
}
