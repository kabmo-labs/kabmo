/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Read a session's Kabmo change journal, with omp's journal as the fallback and
 * the pre-feature half merged in.
 *
 * The Kabmo journal is the answer when it has any `change` record: it sees the
 * `bash` mutations omp never records, and a delete is a record rather than a
 * creation whose file happens to be gone. A session that predates the feature
 * has no Kabmo journal, so the omp reader answers — read directly, not
 * imported, because an import would duplicate the blobs and the lines.
 *
 * A session that SPANS the feature is the third case: it ran before the journal
 * existed and continued after it. The Kabmo journal then starts mid-session, so
 * the omp records older than its first line are merged in. Newer omp records
 * are not: from the first Kabmo line on, the Kabmo journal is the authority,
 * and merging both would double every edit the two writers both saw.
 *
 * Each merged record carries the store its blob keys belong to, so a diff whose
 * two sides straddle the boundary reads the right blob directory.
 *
 * The parse is cached by the size+mtime of every journal file, the same rule
 * the omp reader follows. A torn final line is skipped, not fatal.
 */

import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { blobsDir, sessionChangesDir } from '@/server/lib/changes/paths.server';
import { readBlob } from '@/server/lib/changes/blobs.server';
import { parseJournalLine, type JournalChangeRecord } from '@/server/lib/changes/records';
import {
  readSessionChangeIndex as readOmpIndex,
  readSessionChangeList as readOmpList,
} from '@/server/lib/omp/session/changes';
import { findSessionFileById } from '@/server/lib/omp/session/locator';
import { siblingDirForSession } from '@/server/lib/omp/subagent/history/paths';
import { unifiedDiff } from '@/shared/lib/fs/unified-diff';
import { patchSides } from '@/shared/lib/fs/patch-sides';
import type {
  SessionChangeCounts,
  SessionChangeDiff,
  SessionChangeRecord,
} from '@/shared/types/session-changes';

interface CacheEntry {
  signature: string;
  records: JournalChangeRecord[];
}

interface CacheHost {
  entries: Map<string, CacheEntry>;
}

declare global {
  // eslint-disable-next-line no-var
  var __kabmoChangeJournalCache: CacheHost | undefined;
}

function cache(): CacheHost {
  if (!globalThis.__kabmoChangeJournalCache) globalThis.__kabmoChangeJournalCache = { entries: new Map() };
  return globalThis.__kabmoChangeJournalCache;
}

/** Journal files oldest first: rotated `changes.<epoch>.jsonl`, then the current one. */
function journalFiles(names: string[]): string[] {
  return names
    .filter((name) => name === 'changes.jsonl' || /^changes\.\d+\.jsonl$/.test(name))
    .sort();
}

async function signatureFor(dir: string, files: string[]): Promise<string> {
  const parts: string[] = [];
  for (const name of files) {
    const info = await stat(path.join(dir, name)).catch(() => null);
    parts.push(`${name}:${info?.size ?? 0}:${info?.mtimeMs ?? 0}`);
  }
  return parts.join('|');
}

async function readJournalRecords(sessionId: string): Promise<JournalChangeRecord[]> {
  let dir: string;
  try {
    dir = sessionChangesDir(sessionId);
  } catch {
    return [];
  }
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const files = journalFiles(names);
  if (files.length === 0) return [];

  const signature = await signatureFor(dir, files);
  const cached = cache().entries.get(sessionId);
  if (cached && cached.signature === signature) return cached.records;

  const records: JournalChangeRecord[] = [];
  for (const name of files) {
    const text = await Bun.file(path.join(dir, name)).text().catch(() => '');
    for (const line of text.split('\n')) {
      const record = parseJournalLine(line);
      if (record?.type === 'change') records.push(record);
    }
  }
  records.sort((a, b) => a.at - b.at);
  cache().entries.set(sessionId, { signature, records });
  return records;
}

/** One record plus the blob store its `before`/`after` keys belong to. */
interface MergedRecord {
  at: number;
  runId?: string;
  runAt?: number;
  agent: string;
  parent?: string;
  tool: string;
  path: string;
  displayPath: string;
  before: string | null | undefined;
  after: string | null | undefined;
  store: 'kabmo' | 'omp';
}

/** The omp journal's blob directory, or `null` when the session has no file. */
async function ompBlobDir(sessionId: string): Promise<string | null> {
  const sessionFile = await findSessionFileById(sessionId);
  if (!sessionFile) return null;
  return path.join(siblingDirForSession(sessionFile), 'blobs');
}

/**
 * The session's records, oldest first.
 *
 * `list` selects the omp reader's list variant (which drops a creation whose
 * file is gone) for the no-Kabmo fallback. Once a Kabmo journal exists, the omp
 * half is read RAW: the Kabmo `delete` record is the other half of a
 * create-then-delete, and the client's net logic drops the pair.
 */
async function readMergedRecords(sessionId: string, list: boolean): Promise<MergedRecord[]> {
  const kabmo = await readJournalRecords(sessionId);
  if (kabmo.length === 0) {
    const omp = list ? await readOmpList(sessionId) : await readOmpIndex(sessionId);
    return omp.map((record) => ({ ...record, store: 'omp' as const }));
  }

  const firstKabmoAt = kabmo[0].at;
  const omp = await readOmpIndex(sessionId);
  const merged: MergedRecord[] = [];
  for (const record of omp) {
    if (record.at >= firstKabmoAt) continue;
    merged.push({ ...record, store: 'omp' });
  }
  for (const record of kabmo) {
    merged.push({
      at: record.at,
      ...(record.runId ? { runId: record.runId } : {}),
      ...(record.runAt !== undefined ? { runAt: record.runAt } : {}),
      agent: record.agent,
      ...(record.parent ? { parent: record.parent } : {}),
      tool: record.tool,
      path: record.path,
      displayPath: record.displayPath,
      before: record.before,
      after: record.after,
      store: 'kabmo',
    });
  }
  merged.sort((a, b) => a.at - b.at);
  return merged;
}

function toSessionChangeRecord(record: MergedRecord): SessionChangeRecord {
  return {
    at: record.at,
    ...(record.runId ? { runId: record.runId } : {}),
    ...(record.runAt !== undefined ? { runAt: record.runAt } : {}),
    agent: record.agent,
    ...(record.parent ? { parent: record.parent } : {}),
    tool: record.tool,
    path: record.path,
    displayPath: record.displayPath,
    before: record.before,
    after: record.after,
  };
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

/** Resolve a blob key from the store that wrote it. */
async function resolveMergedBlob(
  sessionId: string,
  store: MergedRecord['store'],
  key: string | null | undefined,
): Promise<string | null | undefined> {
  if (key === null) return null;
  if (key === undefined) return undefined;
  if (store === 'kabmo') return readBlob(blobsDir(sessionId), key);
  const dir = await ompBlobDir(sessionId);
  return dir ? readBlob(dir, key) : undefined;
}

/** Every change record of one session, oldest first, with display paths. */
export async function readSessionChangeIndex(sessionId: string): Promise<SessionChangeRecord[]> {
  const records = await readMergedRecords(sessionId, false);
  return records.map(toSessionChangeRecord);
}

/**
 * The index the chat's per-run list reads.
 *
 * A session with no Kabmo journal falls back to the omp list, which still needs
 * its "creation whose file is gone" heuristic. Once a Kabmo journal exists, the
 * merged list is raw and the client's net logic drops a create-then-delete.
 */
export async function readSessionChangeList(sessionId: string): Promise<SessionChangeRecord[]> {
  const records = await readMergedRecords(sessionId, true);
  // The omp half keeps its own heuristic for a path the Kabmo journal never
  // mentions: a creation whose file is gone was created and deleted before the
  // feature, and its net change is zero. A path the Kabmo journal DOES mention
  // is left to the client's net logic, which sees the Kabmo delete record.
  const kabmoPaths = new Set(records.filter((record) => record.store === 'kabmo').map((record) => record.path));
  const gone = new Set<string>();
  await Promise.all(
    records
      .filter((record) => record.store === 'omp' && record.before === null && !kabmoPaths.has(record.path))
      .map(async (record) => {
        if (!(await pathExists(record.path))) gone.add(record.path);
      }),
  );
  return records.filter((record) => !gone.has(record.path)).map(toSessionChangeRecord);
}

/** The net change of `absolutePath` inside `[from, to]`. */
export async function readSessionChangeDiff(
  sessionId: string,
  absolutePath: string,
  from: number,
  to: number,
): Promise<SessionChangeDiff | null> {
  const records = await readMergedRecords(sessionId, false);
  const inRange = records
    .filter((record) => record.path === absolutePath && record.at >= from && record.at <= to)
    .sort((a, b) => a.at - b.at);
  if (inRange.length === 0) return null;

  const first = inRange[0];
  const last = inRange[inRange.length - 1];
  const status = first.before === null ? 'added' : last.after === null ? 'deleted' : 'modified';
  const [before, after] = await Promise.all([
    resolveMergedBlob(sessionId, first.store, first.before),
    resolveMergedBlob(sessionId, last.store, last.after),
  ]);
  if (before === undefined || after === undefined) {
    return {
      path: absolutePath,
      displayPath: last.displayPath,
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
    displayPath: last.displayPath,
    status,
    oldContent,
    newContent,
    diff: unifiedDiff(last.displayPath, oldContent, newContent),
    unavailable: false,
  };
}

/** Net `+`/`−` line counts for every path changed inside `[from, to]`. */
export async function readSessionChangeStats(
  sessionId: string,
  from: number,
  to: number,
): Promise<Record<string, SessionChangeCounts>> {
  const records = await readMergedRecords(sessionId, false);
  const spans = new Map<string, { first: MergedRecord; last: MergedRecord }>();
  for (const record of records) {
    if (record.at < from || record.at > to) continue;
    const span = spans.get(record.path);
    if (span) span.last = record;
    else spans.set(record.path, { first: record, last: record });
  }

  const stats: Record<string, SessionChangeCounts> = {};
  await Promise.all(
    [...spans].map(async ([absolutePath, { first, last }]) => {
      const [before, after] = await Promise.all([
        resolveMergedBlob(sessionId, first.store, first.before),
        resolveMergedBlob(sessionId, last.store, last.after),
      ]);
      if (before === undefined || after === undefined) return;
      const sides = patchSides(unifiedDiff(absolutePath, before ?? '', after ?? ''));
      if (sides.additions === 0 && sides.deletions === 0) return;
      stats[absolutePath] = { added: sides.additions, removed: sides.deletions };
    }),
  );
  return stats;
}
