/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The session-file CACHE layer: which files exist, what each one's summary is,
 * and how to resolve an id to a path without re-reading the tree.
 *
 * Three caches, all keyed so they invalidate for free:
 *
 *   - the file list, on the sessions root's per-project directory mtimes (a new
 *     session bumps its project dir, so add/remove invalidates it);
 *   - the per-file summary, on that file's `(size, mtimeMs)`;
 *   - the `id → path` index, rebuilt from the file list.
 *
 * The mtime key is the RAW `stat.mtimeMs`, never a `Date`: `getTime()`
 * truncates the fractional millisecond APFS reports, which made the summary
 * cache miss on every call (measured: 451 of 452 files).
 *
 * The read itself lives in `./scan`; `clearSessionFileCaches()` is the one
 * invalidation point every mutation path already calls.
 */

import fs from 'fs';
import * as path from 'path';
import { getSessionsDir } from '@/server/lib/omp/core/paths';
import { isRecord } from '@/shared/lib/util/guards';
import { SESSION_TITLE_SLOT_BYTES, scanSessionInfo, type OmpSessionInfo } from '@/server/lib/omp/session/scan';

export { SESSION_TITLE_SLOT_BYTES, scanSessionInfo };
export type { OmpSessionInfo };

// ============================================================================
// File-list walk + per-file memo, both mtime-keyed
// ============================================================================

interface SessionFileListCacheEntry {
  /** mtimeMs of every project subdirectory, keyed by directory name. A new
   *  session file bumps its project dir's mtime, so the cache invalidates for
   *  free on add/remove even though the sessions root itself never changes. */
  dirMtimes: Map<string, number>;
  files: string[];
}

/**
 * Shape version of a cached OmpSessionInfo. The caches hang off `globalThis`
 * so they survive a module reload, which means an entry written by an older
 * build of this file is still readable after an edit — and a field added or
 * renamed since then reads as undefined at the point of use rather than
 * missing a scan. Bump this whenever OmpSessionInfo changes; the cache is
 * discarded instead of misread.
 */
const SESSION_SCAN_CACHE_VERSION = 3;

interface SessionScanCache {
  version: number;
  entries: Map<string, OmpSessionInfo>;
}

declare global {
  var __kabmoSessionFileListCache: Map<string, SessionFileListCacheEntry> | undefined;
  var __kabmoSessionScanCache: SessionScanCache | undefined;
}

const MAX_SESSION_SCAN_CACHE_ENTRIES = 2048;

/**
 * Walk `<sessionsRoot>/<project>/*.jsonl`, caching on the root directory's
 * mtimeMs: creating/deleting a session bumps the parent directory's mtime, so
 * the cache invalidates for free on every add/remove. A directory that no
 * longer exists yields [] rather than throwing.
 */
export async function listSessionFiles(sessionsRoot: string = getSessionsDir()): Promise<string[]> {
  try {
    await Bun.file(sessionsRoot).stat();
  } catch {
    return [];
  }
  if (!globalThis.__kabmoSessionFileListCache) {
    globalThis.__kabmoSessionFileListCache = new Map();
  }
  const cache = globalThis.__kabmoSessionFileListCache;
  const cached = cache.get(sessionsRoot);
  if (cached) {
    let fresh = true;
    for (const dirent of await fs.promises.readdir(sessionsRoot, { withFileTypes: true })) {
      if (!dirent.isDirectory()) continue;
      try {
        const stat = await Bun.file(path.join(sessionsRoot, dirent.name)).stat();
        if (cached.dirMtimes.get(dirent.name) !== stat.mtimeMs) {
          fresh = false;
          break;
        }
      } catch {
        fresh = false;
        break;
      }
    }
    if (fresh && cached.dirMtimes.size > 0) return cached.files;
  }

  const files: string[] = [];
  const dirMtimes = new Map<string, number>();
  let dirents: fs.Dirent[] = [];
  try {
    dirents = await fs.promises.readdir(sessionsRoot, { withFileTypes: true });
  } catch {
    // Unreadable sessions root — treat as empty.
  }
  for (const dirent of dirents) {
    if (!dirent.isDirectory()) continue;
    const projectDir = path.join(sessionsRoot, dirent.name);
    try {
      dirMtimes.set(dirent.name, (await Bun.file(projectDir).stat()).mtimeMs);
    } catch {
      continue;
    }
    let entries: fs.Dirent[] = [];
    try {
      entries = await fs.promises.readdir(projectDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      // Skip per-session artifacts directories (file name minus .jsonl) —
      // only regular files ending in .jsonl are accepted.
      if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue;
      files.push(path.join(projectDir, entry.name));
    }
  }

  cache.set(sessionsRoot, { dirMtimes, files });
  // A rebuilt list means the directory moved (a session was added or removed),
  // which is exactly when the `id → path` index is stale — it is derived from
  // this list, and its own mtime key cannot see a file that is not in it yet.
  globalThis.__kabmoSessionIdIndex?.delete(sessionsRoot);
  return files;
}

function getSessionScanCache(): Map<string, OmpSessionInfo> {
  const slot = globalThis.__kabmoSessionScanCache;
  if (slot && slot.version === SESSION_SCAN_CACHE_VERSION) return slot.entries;
  const fresh: SessionScanCache = { version: SESSION_SCAN_CACHE_VERSION, entries: new Map() };
  globalThis.__kabmoSessionScanCache = fresh;
  return fresh.entries;
}

/** scanSessionInfo memoized on (path, size, mtimeMs) — an unchanged file costs
 *  a single stat. Cache hits share one object; callers must treat results as
 *  immutable. Exported so the id locator shares this cache with the sidebar
 *  list instead of re-reading every prefix and tail on each resolve. */
export async function scanSessionInfoCached(filePath: string): Promise<OmpSessionInfo | undefined> {
  let stat: { size: number; mtimeMs: number };
  try {
    stat = await Bun.file(filePath).stat();
  } catch {
    return undefined;
  }
  const cache = getSessionScanCache();
  const cached = cache.get(filePath);
  if (cached) {
    const info = cached;
    // Re-scan when size or mtime changed. The version is the FILE mtime, not
    // `modified` — the latter is now an entry timestamp, and a title-slot
    // rewrite that bumps the file without appending an entry must still be
    // picked up (it can change the title the row displays).
    //
    // The comparison is against the RAW `stat.mtimeMs`: `Date.getTime()`
    // truncates the fractional millisecond APFS reports, so a Date comparison
    // never matched and this cache never hit (measured: 451 of 452 files).
    if (info.size === stat.size && info.fileMtimeMs === stat.mtimeMs) {
      cache.delete(filePath);
      cache.set(filePath, info);
      return info;
    }
    cache.delete(filePath);
  }
  const info = await scanSessionInfo(filePath);
  // Failed scans are not negatively cached: a transient read error must not
  // hide a session until its next mtime bump.
  if (info) {
    cache.set(filePath, info);
    while (cache.size > MAX_SESSION_SCAN_CACHE_ENTRIES) {
      const oldestKey = cache.keys().next().value;
      if (oldestKey === undefined) break;
      cache.delete(oldestKey);
    }
  }
  return info;
}

/**
 * Map `items` through an async `worker`, at most `limit` in flight.
 *
 * The session scans are I/O-bound, so a sequential loop serializes round trips
 * the filesystem answers in parallel (measured 36 ms sequential against 12 ms
 * for the same warm work over 452 files). The bound is what keeps an unbounded
 * `Promise.all` from opening one descriptor per session file on a host with a
 * low soft limit.
 */
async function mapBounded<T, R>(items: readonly T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const runners = new Array(Math.min(limit, items.length)).fill(null).map(async () => {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      out[index] = await worker(items[index]);
    }
  });
  await Promise.all(runners);
  return out;
}

/** Concurrent per-file scans; each holds one descriptor while it stats/reads. */
const SESSION_SCAN_CONCURRENCY = 32;

/**
 * List every session across all project subdirectories of the sessions root,
 * newest-modified first. Invalidates are automatic via mtime keys; callers
 * that mutate sessions may clear caches via clearSessionFileCaches().
 */
export async function listAllSessionInfos(sessionsRoot: string = getSessionsDir()): Promise<OmpSessionInfo[]> {
  const files = await listSessionFiles(sessionsRoot);
  const scanned = await mapBounded(files, SESSION_SCAN_CONCURRENCY, (file) => scanSessionInfoCached(file));
  const sessions: OmpSessionInfo[] = [];
  for (const info of scanned) {
    if (info) sessions.push(info);
  }
  sessions.sort((a, b) => b.modified.getTime() - a.modified.getTime());
  return sessions;
}

/**
 * `id → path` for every session file under `sessionsRoot`, built from the same
 * mtime-keyed scan cache the sidebar list fills.
 *
 * Resolving one id used to mean scanning every file until it matched —
 * measured 34.8 ms for the 452 files on this machine, on the hot path of eight
 * routes. The index is derived from `listAllSessionInfos`' own results, so it
 * costs one map build and invalidates with the caches it reads.
 *
 * Cached per root on `globalThis` (a `bun --hot` reload keeps it) and dropped
 * by `clearSessionFileCaches()`, which every mutation path already calls.
 */
interface SessionIdIndex {
  entries: Map<string, string>;
}

declare global {
  var __kabmoSessionIdIndex: Map<string, SessionIdIndex> | undefined;
}

/** The `id → path` index for `sessionsRoot`, building it on first use. */
export async function sessionIdIndex(sessionsRoot: string = getSessionsDir()): Promise<Map<string, string>> {
  const host = (globalThis.__kabmoSessionIdIndex ??= new Map());
  const cached = host.get(sessionsRoot);
  if (cached) return cached.entries;
  const entries = new Map<string, string>();
  for (const info of await listAllSessionInfos(sessionsRoot)) {
    // A duplicate id cannot happen (omp ids are UUIDs), but first-wins keeps
    // the answer stable if a copied session file ever appears.
    if (!entries.has(info.id)) entries.set(info.id, info.path);
  }
  host.set(sessionsRoot, { entries });
  return entries;
}

/** Clear in-memory file-list and per-file scan caches (e.g. after a mutation
 *  that mtime keys cannot detect). */
export function clearSessionFileCaches(): void {
  globalThis.__kabmoSessionFileListCache?.clear();
  globalThis.__kabmoSessionScanCache?.entries.clear();
  globalThis.__kabmoSessionIdIndex?.clear();
}

/** Exported for tests/spot-checks: read a raw JSONL session header directly. */
export async function readRawHeaderLine(filePath: string): Promise<Record<string, unknown> | undefined> {
  try {
    // A bounded Blob slice, not `.text().slice(0, n)`: the header lives in the
    // first few hundred bytes, and decoding a whole session to look at them
    // cost 4.9 ms on an 11 MB file against 0.1 ms for the slice.
    const head = await Bun.file(filePath).slice(0, SESSION_TITLE_SLOT_BYTES + 4096).text();
    const lines = head.split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const parsed: unknown = JSON.parse(line);
        if (isRecord(parsed) && parsed.type === 'session') return parsed;
      } catch {
        // Keep scanning lines.
      }
    }
    return undefined;
  } catch {
    return undefined;
  }
}
