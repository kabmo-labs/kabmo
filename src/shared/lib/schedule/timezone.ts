/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * IANA timezone arithmetic for the schedule grammar.
 *
 * A cron expression is a WALL-CLOCK statement: `0 9 * * 1-5` means 09:00 where
 * the user lives, not 09:00 in whatever zone the server process happens to
 * run in. A container is usually UTC, so interpreting the expression with
 * `Date`'s local getters silently fires a "morning" task at the wrong hour for
 * every user east or west of Greenwich. Every task therefore stores its zone,
 * and the parser resolves wall times through this module.
 *
 * The conversion is the standard two-pass offset resolution: guess the instant
 * by treating the wall time as UTC, read the zone's offset at that instant,
 * subtract it, and re-read the offset at the result. A second pass is needed
 * because the first guess can land on the other side of a DST transition.
 * A wall time that does not exist (the spring-forward gap) returns null, and an
 * ambiguous one (the fall-back overlap) resolves to its FIRST occurrence.
 */

export interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let cached = formatters.get(timeZone);
  if (!cached) {
    cached = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, cached);
  }
  return cached;
}

/** Whether `value` names a zone this runtime can resolve. */
export function isValidTimeZone(value: string): boolean {
  if (!value) return false;
  try {
    formatter(value);
    return true;
  } catch {
    return false;
  }
}

/** The zone the process runs in; the default for a task that names none. */
export function serverTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

/** The wall-clock reading of `instant` in `timeZone`. */
export function wallClock(instant: number, timeZone: string): WallClock {
  const parts = formatter(timeZone).formatToParts(new Date(instant));
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((entry) => entry.type === type);
    return part ? Number(part.value) : 0;
  };
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: read('hour'),
    minute: read('minute'),
    second: read('second'),
  };
}

/** The zone's offset from UTC at `instant`, in milliseconds. */
function offsetMs(instant: number, timeZone: string): number {
  const wall = wallClock(instant, timeZone);
  const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
  return asUtc - Math.floor(instant / 1000) * 1000;
}

/**
 * The instant at which `timeZone` reads the given wall time, or null when that
 * wall time does not exist (a spring-forward gap).
 */
export function wallTimeToInstant(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): number | null {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const firstOffset = offsetMs(guess, timeZone);
  let instant = guess - firstOffset;
  const secondOffset = offsetMs(instant, timeZone);
  if (secondOffset !== firstOffset) instant = guess - secondOffset;

  const wall = wallClock(instant, timeZone);
  if (
    wall.year !== year ||
    wall.month !== month ||
    wall.day !== day ||
    wall.hour !== hour ||
    wall.minute !== minute
  ) {
    return null;
  }
  return instant;
}

/** The calendar date `instant` falls on in `timeZone`. */
export function wallDate(instant: number, timeZone: string): { year: number; month: number; day: number } {
  const wall = wallClock(instant, timeZone);
  return { year: wall.year, month: wall.month, day: wall.day };
}
