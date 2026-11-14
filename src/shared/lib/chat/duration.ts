/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Duration helpers for the chat footer: measures how long an AI response run
 * took (from the preceding user message — or the first AI fragment when no
 * user timestamp exists — until the last AI message of that run).
 */

import { parseTodayLabel } from '@/shared/lib/format/time';

type TimedMessage = {
  date?: string;
  timestamp?: string;
  startedAt?: number;
  completedAt?: number;
  role?: string;
};

function parseMsgDate(msg: TimedMessage | undefined): number | null {
  const raw = msg?.date || msg?.timestamp;
  if (!raw) return null;
  // Live-stream messages carry a preformatted "Today, 10:30 AM" label that
  // `new Date()` cannot parse — resolve it against the current day.
  const todayMs = parseTodayLabel(raw);
  if (todayMs !== null) return todayMs;
  const t = new Date(raw).getTime();
  return Number.isNaN(t) ? null : t;
}

/** Turn start: the ms `startedAt` when present, else the string-date fallback. */
function msgStartMs(msg: TimedMessage | undefined): number | null {
  if (typeof msg?.startedAt === 'number' && Number.isFinite(msg.startedAt)) return msg.startedAt;
  return parseMsgDate(msg);
}

/** Turn end: the ms `completedAt` when present (mappers derive it from
 *  `startedAt + durationMs`), else fall back to the start/string date. */
function msgEndMs(msg: TimedMessage | undefined): number | null {
  if (typeof msg?.completedAt === 'number' && Number.isFinite(msg.completedAt)) return msg.completedAt;
  return msgStartMs(msg);
}

/** Human-readable duration: "2m 3s" / "45s" / "1h 4m". Undefined when the run
 *  is under a second or cannot be measured. */
export function formatDuration(ms: number): string | undefined {
  if (!Number.isFinite(ms) || ms < 1000) return undefined;
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

/** Elapsed ms of the AI run ending at messages[lastAiIndex]. Walks back to the
 *  preceding user message (or the earliest AI fragment) to find the start. */
export function responseRunDurationMs(
  messages: TimedMessage[],
  lastAiIndex: number,
): number | null {
  const end = msgEndMs(messages[lastAiIndex]);
  if (end === null) return null;

  let start: number | null = null;
  for (let i = lastAiIndex - 1; i >= 0; i--) {
    if (messages[i]?.role === 'user') {
      // Stop at the latest user message even when its timestamp is missing —
      // the run still starts there, just unmeasurable.
      start = msgStartMs(messages[i]);
      break;
    }
    const d = msgStartMs(messages[i]);
    if (d === null) continue;
    start = d;
  }
  if (start === null || end <= start) return null;
  return end - start;
}

/**
 * Wall-clock window of one run: the opening row's start to the owner row's end.
 *
 * The change journal records epoch-ms write times and nothing that names a
 * message, so this window is what buckets a write into the run that made it.
 * `null` when either end is unmeasurable — a caller then shows no file list
 * rather than guessing.
 */
export function runWindowMs(
  messages: TimedMessage[],
  runStartIndex: number,
  ownerIndex: number,
): { start: number; end: number } | null {
  // A session file can start mid-run: the first run then has no user row
  // (`runStartIndex` is -1), and falling back to the OWNER row's start would
  // begin the window at the last assistant message — after every write the run
  // made. Walk forward from the first row instead.
  const start = runStartIndex >= 0
    ? (msgStartMs(messages[runStartIndex]) ?? msgStartMs(messages[ownerIndex]))
    : firstStartMs(messages, ownerIndex);
  const end = msgEndMs(messages[ownerIndex]);
  if (start === null || end === null || end < start) return null;
  return { start, end };
}

/** First measurable start at or before `lastIndex`, scanning from the top. */
function firstStartMs(messages: TimedMessage[], lastIndex: number): number | null {
  for (let index = 0; index <= lastIndex; index++) {
    const start = msgStartMs(messages[index]);
    if (start !== null) return start;
  }
  return null;
}
