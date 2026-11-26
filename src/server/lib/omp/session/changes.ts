/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Read one session's agent change journal (`changes.jsonl`) and the blobs it
 * points at.
 *
 * omp writes the journal beside the session file — `<sessionFile minus
 * .jsonl>/changes.jsonl`, with content-addressed gzip blobs under `blobs/` —
 * from 18.20.1 on. A `change` record names the absolute path, the agent and the
 * tool, and then the write itself in one of two shapes: 18.x stored the before
 * and after as blob keys (`null` = the file did not exist / was deleted,
 * `undefined` = not stored because it exceeded 8 MB), and 19.x stores hunks
 * (`{base, gap, edit, sum}`) that `changes-patch.ts` rebuilds.
 *
 * Two reads sit on top:
 *
 *   - {@link readSessionChangeIndex} — every record, with a display path, for
 *     the chat's per-run file list. No blob content, so it stays small.
 *   - {@link readSessionChangeList} — that index minus creations whose file is
 *     gone (a `bash rm` is never journaled). The route serves this one.
 *
 * The diff and the `+`/`−` counts are not read here: the routes own the merged
 * reader, which resolves a patch record's two sides.
 *
 * The journal is append-only and can grow to megabytes, so the parse is cached
 * by size+mtime (the same rule `plans.ts` follows). A session with no journal
 * (older omp, or no artifacts directory) answers an empty list, never an error.
 */

import { stat } from 'node:fs/promises';
import type { Stats } from 'node:fs';
import path from 'node:path';
import { readRawHeaderLine } from '@kabmo-labs/kabmo-omp-session-scan/files';
import { findSessionFileById } from '@kabmo-labs/kabmo-omp-session-locator';
import { siblingDirForSession } from '@kabmo-labs/kabmo-omp-subagent/history-paths';
import { patchExistence, type OmpPatch } from '@/server/lib/omp/session/changes-patch';
import type { SessionChangeRecord } from '@/shared/types/session-changes';

const JOURNAL_FILE = 'changes.jsonl';

/** omp's own blob cap: a bigger file's record carries `undefined` for the side. */
export const OMP_MAX_BLOB_BYTES = 8 * 1024 * 1024;

/** One raw `change` line, before the display path is resolved. */
interface RawChangeRecord {
  at: number;
  agent: string;
  parent?: string;
  tool: string;
  path: string;
  /** The 18.x shape: a blob key, `null` absent, `undefined` not stored. */
  before?: string | null;
  after?: string | null;
  /** The 19.x shape: hunks instead of keys. See `changes-patch.ts`. */
  patch?: OmpPatch;
  /** From the patch's metadata: the file existed before this write. */
  existedBefore?: boolean;
  /** From the patch's metadata: the file exists after it. */
  existsAfter?: boolean;
}

/** The index record: the public shape plus the patch the merged reader needs. */
export interface OmpChangeIndexRecord extends SessionChangeRecord {
  patch?: OmpPatch;
}

interface JournalCacheEntry {
  size: number;
  mtimeMs: number;
  dir: string;
  cwd: string | null;
  records: RawChangeRecord[];
}

interface JournalCacheHost {
  entries: Map<string, JournalCacheEntry>;
}

declare global {
  // eslint-disable-next-line no-var
  var __kabmoSessionChanges: JournalCacheHost | undefined;
}

function cache(): JournalCacheHost {
  if (!globalThis.__kabmoSessionChanges) globalThis.__kabmoSessionChanges = { entries: new Map() };
  return globalThis.__kabmoSessionChanges;
}

/**
 * `path` relative to the session cwd when it is inside it, else unchanged.
 *
 * The relative branch is a display path, not a filesystem one, so its separator
 * is normalised to `/`: Windows' `path.relative` answers `src\a.ts`, which the
 * chat list and the diff header would otherwise show beside forward-slash paths
 * from every other producer.
 */
function displayPathFor(absolute: string, cwd: string | null): string {
  if (!cwd) return absolute;
  const relative = path.relative(cwd, absolute);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return absolute;
  return relative.replaceAll('\\', '/');
}

/** omp 19's patch payload, or `undefined` for a legacy key record and for a
 *  record omp could not store at all (no `base`, `gap`, `edit` or `sum`). */
function parsePatch(record: Record<string, unknown>): OmpPatch | undefined {
  const hasBase = record.base === null || typeof record.base === 'string';
  const hasGap = record.gap !== undefined;
  const hasEdit = record.edit !== undefined;
  const hasSum = typeof record.sum === 'string';
  if (!hasBase && !hasGap && !hasEdit && !hasSum) return undefined;
  return {
    ...(hasBase ? { base: record.base as string | null } : {}),
    ...(hasGap ? { gap: record.gap } : {}),
    ...(hasEdit ? { edit: record.edit } : {}),
    ...(hasSum ? { sum: record.sum as string } : {}),
  };
}

/** The created/deleted flags chain per path, so they are attached after the parse. */
function attachExistence(records: RawChangeRecord[]): void {
  const byPath = new Map<string, RawChangeRecord[]>();
  for (const record of records) {
    const list = byPath.get(record.path);
    if (list) list.push(record);
    else byPath.set(record.path, [record]);
  }
  for (const list of byPath.values()) {
    const flags = patchExistence(list.map((record) => record.patch));
    list.forEach((record, index) => Object.assign(record, flags[index]));
  }
}

/** Parse the journal's `change` lines; a torn final line is skipped, not fatal. */
function parseJournal(text: string): RawChangeRecord[] {
  const records: RawChangeRecord[] = [];
  for (const line of text.split('\n')) {
    if (!line) continue;
    try {
      const record = JSON.parse(line) as Record<string, unknown>;
      if (record?.type !== 'change') continue;
      if (typeof record.at !== 'number' || typeof record.path !== 'string') continue;
      if (typeof record.agent !== 'string' || typeof record.tool !== 'string') continue;
      const patch = parsePatch(record);
      records.push({
        at: record.at,
        agent: record.agent,
        ...(typeof record.parent === 'string' ? { parent: record.parent } : {}),
        tool: record.tool,
        path: record.path,
        before: record.before as string | null | undefined,
        after: record.after as string | null | undefined,
        ...(patch ? { patch } : {}),
      });
    } catch {
      // A torn final line from a crash mid-append; earlier records stay valid.
    }
  }
  attachExistence(records);
  return records;
}

/** The session's journal, cached by size+mtime; `null` when it has none. */
async function readJournal(sessionId: string): Promise<JournalCacheEntry | null> {
  const sessionFile = await findSessionFileById(sessionId);
  if (!sessionFile) return null;
  const dir = siblingDirForSession(sessionFile);
  const journalPath = path.join(dir, JOURNAL_FILE);
  let info: Stats;
  try {
    info = await stat(journalPath);
  } catch {
    return null;
  }
  const cached = cache().entries.get(sessionId);
  if (cached && cached.size === info.size && cached.mtimeMs === info.mtimeMs) return cached;

  const text = await Bun.file(journalPath).text();
  const header = await readRawHeaderLine(sessionFile).catch(() => null);
  const cwd = header && typeof header.cwd === 'string' ? header.cwd : null;
  const entry: JournalCacheEntry = {
    size: info.size,
    mtimeMs: info.mtimeMs,
    dir,
    cwd,
    records: parseJournal(text),
  };
  cache().entries.set(sessionId, entry);
  return entry;
}

/**
 * Every change record of one session, oldest first, with display paths.
 *
 * `before` is the 18.x blob key where the record has one, and the patch's
 * `base` otherwise — so a reader that only needs "did it exist" keeps working
 * across both journal formats. `patch` is carried for the merged reader, which
 * rebuilds the content itself.
 */
export async function readSessionChangeIndex(sessionId: string): Promise<OmpChangeIndexRecord[]> {
  const journal = await readJournal(sessionId);
  if (!journal) return [];
  return journal.records.map((record) => ({
    at: record.at,
    agent: record.agent,
    ...(record.parent ? { parent: record.parent } : {}),
    tool: record.tool,
    path: record.path,
    displayPath: displayPathFor(record.path, journal.cwd),
    before: record.before !== undefined ? record.before : record.patch?.base,
    after: record.after,
    ...(record.existedBefore === undefined ? {} : { existedBefore: record.existedBefore }),
    ...(record.existsAfter === undefined ? {} : { existsAfter: record.existsAfter }),
    ...(record.patch ? { patch: record.patch } : {}),
  }));
}

/** True when the path is still on disk; a stat error other than ENOENT counts
 *  as present, so a permission problem never hides a real change. */
async function pathExists(absolute: string): Promise<boolean> {
  try {
    await stat(absolute);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ENOENT';
  }
}

/**
 * The index the chat's per-run list reads: {@link readSessionChangeIndex} minus
 * creations whose file is gone.
 *
 * omp journals edit-tool writes only. A delete through `bash` (`rm`, `git
 * clean`, a script) never reaches `changes.jsonl`, so a file the run created
 * and then removed still reads as `added` — measured on a real session: the
 * run wrote `MarkdownRenderer.test.tsx`, `rm`'d it six seconds later, and the
 * list counted 8 files while the commit had 7. A creation whose path is absent
 * now is that case, and its net change is zero.
 *
 * A MODIFIED path is kept even when absent: the run did change it, and the
 * merged reader still holds its two sides.
 */
export async function readSessionChangeList(sessionId: string): Promise<OmpChangeIndexRecord[]> {
  const records = await readSessionChangeIndex(sessionId);
  if (records.length === 0) return records;

  const firstByPath = new Map<string, OmpChangeIndexRecord>();
  for (const record of records) {
    if (!firstByPath.has(record.path)) firstByPath.set(record.path, record);
  }
  const gone = new Set<string>();
  await Promise.all(
    [...firstByPath].map(async ([absolutePath, first]) => {
      // A patch record states existence itself (`base: null`); a key record
      // says "absent" with a null key and leaves it at that.
      if (first.existedBefore !== undefined ? first.existedBefore : first.before !== null) return;
      if (!(await pathExists(absolutePath))) gone.add(absolutePath);
    }),
  );
  return gone.size === 0 ? records : records.filter((record) => !gone.has(record.path));
}

