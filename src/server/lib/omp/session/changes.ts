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
 * from 18.20.1 on. Each `change` record is one edit-tool write: the absolute
 * path, the agent, the tool, and the content before and after as blob keys
 * (`null` = the file did not exist / was deleted, `undefined` = not stored
 * because it exceeded 8 MB).
 *
 * Two reads sit on top:
 *
 *   - {@link readSessionChangeIndex} — every record, with a display path, for
 *     the chat's per-run file list. No blob content, so it stays small.
 *   - {@link readSessionChangeList} — that index minus creations whose file is
 *     gone (a `bash rm` is never journaled). The route serves this one.
 *   - {@link readSessionChangeDiff} — the net change of one path inside one
 *     run window: the first record's `before` and the last record's `after`.
 *   - {@link readSessionChangeStats} — that same net change as `+`/`−` line
 *     counts for every path in one window, which the run's file summary shows
 *     without opening a diff.
 *
 * The journal is append-only and can grow to megabytes, so the parse is cached
 * by size+mtime (the same rule `plans.ts` follows). A session with no journal
 * (older omp, or no artifacts directory) answers an empty list, never an error.
 */

import { stat } from 'node:fs/promises';
import type { Stats } from 'node:fs';
import path from 'node:path';
import { readRawHeaderLine } from '@/server/lib/omp/session/files';
import { findSessionFileById } from '@/server/lib/omp/session/locator';
import { siblingDirForSession } from '@/server/lib/omp/subagent/history/paths';
import { unifiedDiff } from '@/shared/lib/fs/unified-diff';
import { patchSides } from '@/shared/lib/fs/patch-sides';
import type {
  SessionChangeCounts,
  SessionChangeDiff,
  SessionChangeRecord,
} from '@/shared/types/session-changes';

const JOURNAL_FILE = 'changes.jsonl';
const BLOB_DIR = 'blobs';

/** One raw `change` line, before the display path is resolved. */
interface RawChangeRecord {
  at: number;
  agent: string;
  parent?: string;
  tool: string;
  path: string;
  before: string | null | undefined;
  after: string | null | undefined;
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
      records.push({
        at: record.at,
        agent: record.agent,
        ...(typeof record.parent === 'string' ? { parent: record.parent } : {}),
        tool: record.tool,
        path: record.path,
        before: record.before as string | null | undefined,
        after: record.after as string | null | undefined,
      });
    } catch {
      // A torn final line from a crash mid-append; earlier records stay valid.
    }
  }
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

/** Blob content for a key; `null` = absent file, `undefined` = not stored/missing. */
async function resolveBlob(dir: string, key: string | null | undefined): Promise<string | null | undefined> {
  if (key === null) return null;
  if (key === undefined) return undefined;
  try {
    const bytes = await Bun.file(path.join(dir, BLOB_DIR, key)).bytes();
    return new TextDecoder().decode(Bun.gunzipSync(bytes));
  } catch {
    return undefined;
  }
}

/** Every change record of one session, oldest first, with display paths. */
export async function readSessionChangeIndex(sessionId: string): Promise<SessionChangeRecord[]> {
  const journal = await readJournal(sessionId);
  if (!journal) return [];
  return journal.records.map((record) => ({
    at: record.at,
    agent: record.agent,
    ...(record.parent ? { parent: record.parent } : {}),
    tool: record.tool,
    path: record.path,
    displayPath: displayPathFor(record.path, journal.cwd),
    before: record.before,
    after: record.after,
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
 * journal diff still holds both sides.
 */
export async function readSessionChangeList(sessionId: string): Promise<SessionChangeRecord[]> {
  const records = await readSessionChangeIndex(sessionId);
  if (records.length === 0) return records;

  const firstByPath = new Map<string, SessionChangeRecord>();
  for (const record of records) {
    if (!firstByPath.has(record.path)) firstByPath.set(record.path, record);
  }
  const gone = new Set<string>();
  await Promise.all(
    [...firstByPath].map(async ([absolutePath, first]) => {
      if (first.before !== null) return;
      if (!(await pathExists(absolutePath))) gone.add(absolutePath);
    }),
  );
  return gone.size === 0 ? records : records.filter((record) => !gone.has(record.path));
}

/**
 * The net change of `absolutePath` inside `[from, to]`: the first record's
 * `before` and the last record's `after`. `null` when the path has no record in
 * the range.
 */
export async function readSessionChangeDiff(
  sessionId: string,
  absolutePath: string,
  from: number,
  to: number,
): Promise<SessionChangeDiff | null> {
  const journal = await readJournal(sessionId);
  if (!journal) return null;
  const inRange = journal.records
    .filter((record) => record.path === absolutePath && record.at >= from && record.at <= to)
    .sort((a, b) => a.at - b.at);
  if (inRange.length === 0) return null;

  const first = inRange[0];
  const last = inRange[inRange.length - 1];
  const displayPath = displayPathFor(absolutePath, journal.cwd);
  const status = first.before === null ? 'added' : last.after === null ? 'deleted' : 'modified';
  const [before, after] = await Promise.all([
    resolveBlob(journal.dir, first.before),
    resolveBlob(journal.dir, last.after),
  ]);
  if (before === undefined || after === undefined) {
    return {
      path: absolutePath,
      displayPath,
      status,
      oldContent: '',
      newContent: '',
      diff: '',
      unavailable: true,
    };
  }
  const oldContent = before ?? '';
  const newContent = after ?? '';
  return {
    path: absolutePath,
    displayPath,
    status,
    oldContent,
    newContent,
    diff: unifiedDiff(displayPath, oldContent, newContent),
    unavailable: false,
  };
}

/**
 * Net `+`/`−` line counts for every path changed inside `[from, to]`.
 *
 * The net rule is {@link readSessionChangeDiff}'s — first record's `before` to
 * last record's `after` — so the summary's numbers describe the diff the file
 * opens, not the churn of each intermediate write. A path whose blob was not
 * stored is absent rather than counted as zero: a count would be a guess.
 */
export async function readSessionChangeStats(
  sessionId: string,
  from: number,
  to: number,
): Promise<Record<string, SessionChangeCounts>> {
  const journal = await readJournal(sessionId);
  if (!journal) return {};

  const spans = new Map<string, { first: RawChangeRecord; last: RawChangeRecord }>();
  for (const record of journal.records) {
    if (record.at < from || record.at > to) continue;
    const span = spans.get(record.path);
    if (span) span.last = record;
    else spans.set(record.path, { first: record, last: record });
  }

  const stats: Record<string, SessionChangeCounts> = {};
  await Promise.all(
    [...spans].map(async ([absolutePath, { first, last }]) => {
      const [before, after] = await Promise.all([
        resolveBlob(journal.dir, first.before),
        resolveBlob(journal.dir, last.after),
      ]);
      if (before === undefined || after === undefined) return;
      const sides = patchSides(unifiedDiff(absolutePath, before ?? '', after ?? ''));
      if (sides.additions === 0 && sides.deletions === 0) return;
      stats[absolutePath] = { added: sides.additions, removed: sides.deletions };
    }),
  );
  return stats;
}
