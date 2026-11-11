/** Compact relative age for sidebar rows: `now`, `5m`, `3h`, `2d`, `6w`, or a
 *  `DD MMM` date once the timestamp is older than a year. Returns null for a
 *  missing/unparseable timestamp so callers can omit the column entirely. */
export function relativeTimeAgo(value: string | number | null | undefined, now: number = Date.now()): string | null {
  if (value === null || value === undefined || value === '') return null;
  const ms = typeof value === 'number' ? value : Date.parse(value);
  if (Number.isNaN(ms)) return null;

  const seconds = Math.round((now - ms) / 1000);
  if (seconds < 45) return 'now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d`;
  const weeks = Math.round(days / 7);
  if (weeks < 5) return `${weeks}w`;

  const date = new Date(ms);
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  const day = date.getDate();
  const month = date.toLocaleString('en-US', { month: 'short' });
  return sameYear ? `${day} ${month}` : `${day} ${month} ${date.getFullYear()}`;
}

/** Full timestamp for a row's hover tooltip: `Wed, 12 Nov 2026, 02:30 PM`.
 *  Returns null for a missing/unparseable timestamp, matching `relativeTimeAgo`. */
export function formatFullDate(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return null;
  const ms = typeof value === 'number' ? value : Date.parse(value);
  if (Number.isNaN(ms)) return null;
  return new Date(ms).toLocaleString('en-US', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
