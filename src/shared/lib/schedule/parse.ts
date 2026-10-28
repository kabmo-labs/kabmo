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

function dayMatches(fields: CronFields, date: Date): boolean {
  const dom = date.getDate();
  const dow = date.getDay();
  const byDom = fields.daysOfMonth.includes(dom);
  const byDow = fields.daysOfWeek.includes(dow);
  // Vixie cron: with both fields restricted the day matches if EITHER does.
  if (fields.domRestricted && fields.dowRestricted) return byDom || byDow;
  if (fields.domRestricted) return byDom;
  if (fields.dowRestricted) return byDow;
  return true;
}

function firstAtLeast(values: number[], floor: number): number | null {
  for (const value of values) if (value >= floor) return value;
  return null;
}

/**
 * The first fire strictly after `from`, in local time. Null when the
 * expression never matches inside the horizon (an impossible date such as
 * `0 0 30 2 *`).
 */
export function nextCronOccurrence(fields: CronFields, from: Date): number | null {
  // Cron fires on minute boundaries; the next candidate is the start of the
  // minute after `from`, so a fire at exactly `from` is not re-scheduled.
  const cursor = new Date(from.getTime());
  cursor.setSeconds(0, 0);
  cursor.setMinutes(cursor.getMinutes() + 1);

  const cursorDayStart = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate()).getTime();
  const horizon = new Date(cursorDayStart);
  horizon.setFullYear(horizon.getFullYear() + 8);

  // The walk advances one CALENDAR DAY at a time, and a month the month-field
  // excludes is jumped whole. Advancing by an offset instead would land
  // mid-month after a skip and miss the first of the month it jumped to.
  for (let day = new Date(cursorDayStart); day.getTime() <= horizon.getTime(); ) {
    if (!fields.months.includes(day.getMonth() + 1)) {
      day = new Date(day.getFullYear(), day.getMonth() + 1, 1);
      continue;
    }
    if (dayMatches(fields, day)) {
      const sameDay = day.getTime() === cursorDayStart;
      const hourFloor = sameDay ? cursor.getHours() : 0;
      const hour = firstAtLeast(fields.hours, hourFloor);
      if (hour !== null) {
        const minuteFloor = sameDay && hour === cursor.getHours() ? cursor.getMinutes() : 0;
        const minute = firstAtLeast(fields.minutes, minuteFloor);
        if (minute !== null) {
          return new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute, 0, 0).getTime();
        }
      }
    }
    day = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);
  }
  return null;
}

/** Parse a `once` spec (ISO-8601 timestamp, or epoch ms). */
export function parseOnce(spec: string): number | null {
  const text = spec.trim();
  if (!text) return null;
  if (/^\d+$/.test(text)) {
    const ms = Number(text);
    return ms > 0 ? ms : null;
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
export function validateSchedule(kind: ScheduleKind, spec: string, now = Date.now()): ScheduleValidation {
  if (!spec.trim()) return { ok: false, error: 'Enter a schedule.' };
  if (kind === 'once') {
    const at = parseOnce(spec);
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
  const next = nextCronOccurrence(fields, new Date(now));
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
): number | null {
  if (kind === 'once') return null;
  if (kind === 'every') {
    const interval = parseInterval(spec);
    return interval === null ? null : after + interval;
  }
  const fields = parseCron(spec);
  return fields ? nextCronOccurrence(fields, new Date(after)) : null;
}

/** Human summary of a schedule for the task list and the run log. */
export function describeSchedule(kind: ScheduleKind, spec: string): string {
  const text = spec.trim();
  if (kind === 'once') {
    const at = parseOnce(text);
    return at === null ? text : `Once at ${new Date(at).toLocaleString()}`;
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
