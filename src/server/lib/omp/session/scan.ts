/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * One oh-my-pi session file → its compact sidebar summary.
 *
 * Split out of `./files` so that module holds only the cache layer (the
 * mtime-keyed file list, the per-file memo, and the `id → path` index) while
 * this one holds the read: a 4 KiB prefix window for the header, title and
 * first message, plus a bounded tail window for last activity. Nothing here
 * touches a cache, so a scan is always a real read of the file's current bytes.
 *
 * File layout: optional fixed-width 256-byte title-slot line, then the
 * {"type":"session"} header line, then message entries. Legacy pi v1/v2 shapes
 * parse leniently (raw-text scans); nothing here mutates on-disk data.
 */

import { readLastEntryTimestamp, readTextPrefix, SESSION_LIST_PREFIX_BYTES } from '@/server/lib/omp/session/file-scan';
import { countMessageMarkers, parseJsonlLenient, parseSessionListHeader } from '@/shared/lib/omp/session/jsonl';
import { firstOperatorTitleFromPrefix, operatorTitleFromEntry } from '@/shared/lib/omp/session/operator-title';

export const SESSION_TITLE_SLOT_BYTES = 256;

/** Compact summary of one session file — the sidebar list row. */
export interface OmpSessionInfo {
  /** Absolute path of the .jsonl file. */
  path: string;
  id: string;
  /** Working directory the session ran in (from the header). */
  cwd: string;
  /** User-facing title (title slot wins; falls back to header title). */
  title?: string;
  parentSessionPath?: string;
  created: Date;
  /** Last activity: the newest JSONL entry's own `timestamp`, falling back to
   *  the file mtime for a file the tail window cannot date. */
  modified: Date;
  /** Filesystem mtime. Scan-cache version only — never user-visible, and never
   *  an ordering key (see readLastEntryTimestamp for why). */
  fileMtime: Date;
  /**
   * The same mtime as a raw `stat.mtimeMs`. The cache compares THIS, not
   * `fileMtime`: `Date.getTime()` truncates the fractional millisecond that
   * APFS/HFS+ report, so comparing the Date never matched and the cache never
   * hit — every request re-read 452 files' prefix and tail (measured 36-45 ms
   * warm against 5.6 ms with the raw key).
   */
  fileMtimeMs: number;
  messageCount: number;
  size: number;
  firstMessage: string;
}

/**
 * Scan a single session file into an OmpSessionInfo from a 4 KiB prefix window
 * (header, title, first message) plus a bounded tail window (last activity).
 * Faithful port of omp's scanSessionFile except for `modified`, which is the
 * last entry's timestamp rather than the file mtime. Missing/unreadable/
 * header-less files yield undefined instead of throwing.
 */
export async function scanSessionInfo(filePath: string): Promise<OmpSessionInfo | undefined> {
  try {
    const { text: prefix, size, mtime, mtimeMs } = await readTextPrefix(filePath, SESSION_LIST_PREFIX_BYTES);
    const lastEntryAt = await readLastEntryTimestamp(filePath, size, prefix);
    const entries = parseJsonlLenient<Record<string, unknown>>(prefix);
    const header = parseSessionListHeader(prefix, entries);
    if (!header) return undefined;

    let parsedMessageCount = 0;
    let firstMessage = '';
    let shortSummary: string | undefined;
    for (let i = 1; i < entries.length; i++) {
      const entry = entries[i] as {
        type?: string;
        message?: { role?: string; content?: unknown };
        shortSummary?: string;
      };
      if (entry.type === 'compaction' && typeof entry.shortSummary === 'string') {
        shortSummary = entry.shortSummary;
      }
      if (entry.type === 'message' && entry.message) {
        parsedMessageCount++;
      }
      // The operator's opening turn, by the ONE rule every surface shares — a
      // `user` message OR a `/skill:` custom entry. A skill turn carries no
      // `role` field, so a scan that looked only for `role: "user"` reported
      // `(no messages)` for a session opened with `/skill:<name>` and its row
      // read "New Session - <timestamp>" while the header showed the title.
      if (!firstMessage) {
        const operator = operatorTitleFromEntry(entry as Record<string, unknown>);
        if (operator) firstMessage = operator;
      }
    }

    // The window is bounded, so a preamble (a skill's expanded body) can push
    // the opening turn past it. `firstMessage` stays empty in that case and the
    // raw-text pass below is the only chance — it is what keeps this reader in
    // agreement with the header instead of guessing a placeholder.
    firstMessage ||= firstOperatorTitleFromPrefix(prefix) ?? '';
    return {
      path: filePath,
      id: header.id,
      cwd: header.cwd ?? '',
      title: header.title ?? shortSummary,
      parentSessionPath: header.parentSession,
      created: new Date(header.timestamp ?? ''),
      modified: lastEntryAt ?? mtime,
      fileMtime: mtime,
      fileMtimeMs: mtimeMs,
      messageCount: Math.max(parsedMessageCount, countMessageMarkers(prefix)),
      size,
      firstMessage: firstMessage || '(no messages)',
    };
  } catch {
    return undefined;
  }
}
