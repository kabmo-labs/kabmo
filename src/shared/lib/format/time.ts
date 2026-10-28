/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Shared time formatters for the chat timeline: the live-stream path carries a
 * preformatted "Today, 10:30 AM" label that `new Date()` cannot parse, so both
 * the footer display and the run-duration math resolve it against today's date.
 */

/** "10:30 AM" — 12-hour clock used by every message timestamp. */
export function formatClock(value: Date | number = new Date()): string {
  return new Date(value).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

/**
 * Resolve a preformatted `"Today, <time>"` label to epoch ms against the
 * current day. Returns null when the label is not a "Today," value or its time
 * part cannot be parsed.
 */
export function parseTodayLabel(raw: string): number | null {
  if (!raw.startsWith('Today,')) return null;
  const time = raw.slice('Today,'.length).trim();
  const parsed = new Date(`${new Date().toDateString()} ${time}`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
}

/**
 * Timeline stamp for a message row / run footer: `"Today, 10:30 AM"` for the
 * live path, `"Sep 9, 04:43 AM"` for historical rows, empty when unparseable.
 */
export function formatMessageStamp(msg?: { date?: string; timestamp?: string }): string {
  const raw = msg?.timestamp || msg?.date;
  if (!raw) return '';
  if (raw.startsWith('Today,')) return `Today, ${raw.slice('Today,'.length).trim()}`;
  // Bare "10:30 AM" timestamp (live path) — resolve against today.
  if (/^\d{1,2}:\d{2}\s*(AM|PM)$/i.test(raw)) {
    const parsedMs = parseTodayLabel(`Today, ${raw}`);
    if (parsedMs !== null) return `Today, ${formatClock(parsedMs)}`;
  }
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return '';
  const day = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${day}, ${formatClock(date)}`;
}

/**
 * Best-effort tool-detail timestamp: epoch-ms renders as the runtime's default
 * locale time, a string passes through, anything else renders empty.
 */
export function formatTimestamp(value: unknown): string {
  if (typeof value === 'number') {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString();
  }
  return typeof value === 'string' ? value : '';
}
