/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Bounded readers for one oh-my-pi session file: a fixed-size head window and
 * a tail window that dates the session's real last activity. Split out of
 * ./files.ts so the scanner there stays under the file-size ceiling; both
 * windows exist so a session file is never loaded whole into memory.
 */

import { extractStringProperty } from '@/shared/lib/omp/session/jsonl';
import { isRecord } from '@/shared/lib/util/guards';

export const SESSION_LIST_PREFIX_BYTES = 4096;

/**
 * Tail window for the last-activity timestamp. The distance from EOF to the
 * newest timestamped line measured at most ~4 KiB across every session on this
 * machine, so 16 KiB carries 4x headroom over the largest final entry seen.
 */
const SESSION_TAIL_BYTES = 16 * 1024;

/**
 * Ceiling for the escalating tail read. A session can legitimately end with an
 * entry larger than the first window — a tool result carrying a big file read
 * or build log — and that entry is usually the newest timestamped line, so
 * falling back to mtime there would reintroduce the bug this exists to fix.
 * The window quadruples up to this ceiling, which is one read per step and
 * only for a session whose final entry is genuinely that large.
 */
const SESSION_TAIL_MAX_BYTES = 1024 * 1024;

/** Head window of a session file plus the stat it was read with. */
export interface SessionFilePrefix {
  text: string;
  size: number;
  mtime: Date;
  /**
   * The same mtime as a raw `stat.mtimeMs`, for callers that key a cache on it.
   * `Date.getTime()` truncates the fractional millisecond APFS reports, so a
   * Date comparison never matches a fresh stat.
   */
  mtimeMs: number;
}

export async function readTextPrefix(filePath: string, prefixBytes: number): Promise<SessionFilePrefix> {
  const file = Bun.file(filePath);
  const stat = await file.stat();
  const prefixLength = Math.min(prefixBytes, stat.size);
  const text = prefixLength > 0 ? await file.slice(0, prefixLength).text() : '';
  return { text, size: stat.size, mtime: new Date(stat.mtimeMs), mtimeMs: stat.mtimeMs };
}

/**
 * omp lifecycle markers: entries the agent writes about the SESSION PROCESS,
 * not about the conversation. `session_exit` is emitted every time an omp
 * child is disposed — an idle timeout, a Kabmo restart, a shutdown — and a
 * session accumulates one per dispose (the file that prompted this rule holds
 * three). Treating the newest one as last activity floats a session that has
 * been quiet for days to the top of `LATEST_SESSION`: measured across a real
 * agent dir, 255 of 319 sessions were ranked by a marker like that, the worst
 * by ~14 days.
 *
 * Only markers KNOWN to be lifecycle are excluded. `tool_execution_start` is
 * the commonest custom entry in the same files (16k occurrences) and IS
 * activity — a run that ends mid-tool-call is still the newest one — so an
 * unrecognised customType is counted rather than ignored.
 */
const LIFECYCLE_CUSTOM_TYPES: Record<string, true> = { session_exit: true };

/** A parsed entry timestamp, flagged when the entry is process bookkeeping. */
interface EntryStamp {
  at: Date;
  lifecycle: boolean;
}

/** Timestamp + lifecycle flag from one JSONL line, or undefined when the line
 *  carries no usable timestamp. */
function entryStampOfLine(line: string): EntryStamp | undefined {
  let type: unknown;
  let customType: unknown;
  let value: unknown;
  let parsedOk = false;
  try {
    const parsed: unknown = JSON.parse(line);
    if (isRecord(parsed)) {
      parsedOk = true;
      type = parsed.type;
      customType = parsed.customType;
      value = parsed.timestamp;
    }
  } catch {
    // Torn or window-truncated line — fall back to the raw-text scan.
  }
  if (!parsedOk) {
    value = extractStringProperty(line, 'timestamp');
    type = extractStringProperty(line, 'type');
    customType = extractStringProperty(line, 'customType');
  }
  let at: Date | undefined;
  if (typeof value === 'number' && Number.isFinite(value)) at = new Date(value);
  else if (typeof value === 'string') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) at = parsed;
  }
  if (!at) return undefined;
  const lifecycle = type === 'custom'
    && typeof customType === 'string'
    && LIFECYCLE_CUSTOM_TYPES[customType] === true;
  return { at, lifecycle };
}

/**
 * Timestamp of the newest entry in a session file, read from a bounded tail
 * window — the session's real last activity.
 *
 * File mtime is NOT that value. A title-slot rename rewrites the first 256
 * bytes in place and bumps mtime without a turn having happened; a full-file
 * title rewrite on a slot-less legacy file does the same; and a session
 * restored or copied from a backup carries an mtime unrelated to its content.
 * Every one of those moved the sidebar's `LATEST_SESSION` order. The last
 * entry's own `timestamp` is what "latest session" means, and it survives all
 * three.
 *
 * Process bookkeeping does not count either — see LIFECYCLE_CUSTOM_TYPES.
 *
 * `prefix` is the already-read 4 KiB head; a file that fits inside it needs no
 * second read — a third of the sessions on a real machine are that small.
 *
 * The window starts at SESSION_TAIL_BYTES and widens toward
 * SESSION_TAIL_MAX_BYTES while it holds no usable entry, so a session ending
 * on one oversized entry is still dated correctly. Only when even the ceiling
 * holds nothing but lifecycle markers — an empty file, or a single entry
 * larger than a megabyte — does this return undefined and let the caller fall
 * back to mtime.
 */
export async function readLastEntryTimestamp(
  filePath: string,
  size: number,
  prefix: string,
): Promise<Date | undefined> {
  if (size <= 0) return undefined;
  let windowBytes = SESSION_TAIL_BYTES;
  for (;;) {
    const start = Math.max(0, size - windowBytes);
    let text: string;
    if (size <= SESSION_LIST_PREFIX_BYTES) {
      // The whole file is inside the prefix window already.
      text = prefix;
    } else if (start === 0) {
      try {
        text = await Bun.file(filePath).text();
      } catch {
        return undefined;
      }
    } else {
      try {
        // Read one byte before the window: if it is a newline the window opens
        // on a line boundary, otherwise the first line is a fragment. Either
        // way the leading split element is not a complete entry.
        text = await Bun.file(filePath).slice(start - 1).text();
      } catch {
        return undefined;
      }
    }
    const lines = text.split('\n');
    if (start > 0) lines.shift();
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (!line.includes('"timestamp"')) continue;
      const stamp = entryStampOfLine(line);
      if (stamp && !stamp.lifecycle) return stamp.at;
    }
    // The window is already the whole file, or it has reached its ceiling.
    if (start === 0 || windowBytes >= SESSION_TAIL_MAX_BYTES) return undefined;
    windowBytes = Math.min(windowBytes * 4, SESSION_TAIL_MAX_BYTES);
  }
}
