/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The JSONL pass behind both telemetry endpoints.
 *
 * `visit` is called per entry and may return `false` to stop early. The parse
 * itself is cached by `(path, size, mtimeMs)`, because `/api/telemetry/context`
 * and `/api/telemetry/raw-messages` are two polling endpoints that parse the
 * SAME file — measured 70.6 ms and 64.2 ms on an 11 MB session, per request,
 * with no cache between them. One parse now serves both until the file moves.
 *
 * The cache is keyed on the raw `stat.mtimeMs`, never a `Date`: `getTime()`
 * truncates the fractional millisecond APFS reports, which is what made the
 * session-scan cache miss on every call (see files.ts).
 */

import { parseJsonlLenient } from '@/shared/lib/omp/session/jsonl';
import type { OmpMessageEntry } from '@/shared/types/omp/session';

/** Sessions larger than this are not cached; a transcript past it is pathological. */
const MAX_CACHED_SESSION_BYTES = 64 * 1024 * 1024;
/** Bound on remembered transcripts, so a long session list cannot retain them all. */
const MAX_CACHED_SESSIONS = 16;

interface CachedEntries {
  size: number;
  mtimeMs: number;
  entries: OmpMessageEntry[];
}

interface ScanCacheHost {
  entries: Map<string, CachedEntries>;
}

declare global {
  // eslint-disable-next-line no-var
  var __kabmoTelemetryScanCache: ScanCacheHost | undefined;
}

function cache(): Map<string, CachedEntries> {
  globalThis.__kabmoTelemetryScanCache ??= { entries: new Map() };
  return globalThis.__kabmoTelemetryScanCache.entries;
}

/**
 * Every entry of `filePath`, parsed once per file version.
 *
 * Callers must treat the returned array (and its entries) as immutable — the
 * same array is handed to the next caller, and the builders only read.
 */
export async function loadSessionEntries(filePath: string): Promise<OmpMessageEntry[]> {
  let size: number;
  let mtimeMs: number;
  try {
    const stat = await Bun.file(filePath).stat();
    size = stat.size;
    mtimeMs = stat.mtimeMs;
  } catch {
    return [];
  }

  const slot = cache();
  const cached = slot.get(filePath);
  if (cached && cached.size === size && cached.mtimeMs === mtimeMs) {
    // Refresh insertion order so the bound evicts the least recently used.
    slot.delete(filePath);
    slot.set(filePath, cached);
    return cached.entries;
  }

  let body: string;
  try {
    body = await Bun.file(filePath).text();
  } catch {
    return [];
  }
  const entries = parseJsonlLenient<OmpMessageEntry>(body);
  if (size <= MAX_CACHED_SESSION_BYTES) {
    slot.set(filePath, { size, mtimeMs, entries });
    while (slot.size > MAX_CACHED_SESSIONS) {
      const oldest = slot.keys().next().value;
      if (oldest === undefined) break;
      slot.delete(oldest);
    }
  }
  return entries;
}

/** JSONL pass for the telemetry builders; `visit` returns `false` to stop early. */
export async function scanSessionEntries(
  filePath: string,
  visit: (entry: OmpMessageEntry, index: number) => boolean | void,
): Promise<void> {
  const records = await loadSessionEntries(filePath);
  for (let index = 0; index < records.length; index++) {
    const entry = records[index];
    if (!entry) continue;
    if (visit(entry, index) === false) break;
  }
}
