/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The Kabmo journal's records, and the merge with omp's older half.
 *
 * Split from `reader.server.ts` (the public read surface) so the cache, the
 * file walk and the merge live together and neither file crosses the size
 * ceiling. The rules are the reader's: the Kabmo journal is the authority from
 * its first line on, omp's records older than that are merged in, and each
 * record carries the blob store its keys belong to.
 */

import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { blobsDir, sessionChangesDir } from '@/server/lib/changes/paths.server';
import { readBlob } from '@/server/lib/changes/blobs.server';
import { parseJournalLine, type JournalChangeRecord } from '@/server/lib/changes/records';
import { isBuildPath, isExcludedTempPath } from '@/server/lib/changes/temp-path';
import { sessionCwd } from '@/server/lib/changes/sessions.server';
import {
  readSessionChangeIndex as readOmpIndex,
  readSessionChangeList as readOmpList,
} from '@/server/lib/omp/session/changes';
import type { OmpPatch } from '@/server/lib/omp/session/changes-patch';
import { findSessionFileById } from '@/server/lib/omp/session/locator';
import { siblingDirForSession } from '@/server/lib/omp/subagent/history/paths';
import type { SessionChangeRecord } from '@/shared/types/session-changes';

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

export async function readJournalRecords(sessionId: string): Promise<JournalChangeRecord[]> {
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
export interface MergedRecord {
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
  /** Why a side is `undefined`; absent means the store's blob cap. */
  unavailableReason?: 'too-large' | 'snapshot-race';
  /** omp 19's hunks; absent on a Kabmo record and on an 18.x key record. */
  patch?: OmpPatch;
  /** The file existed before this write, from the patch's own metadata. */
  existedBefore?: boolean;
  /** The file exists after it, from the patch's own metadata. */
  existsAfter?: boolean;
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
export async function readMergedRecords(sessionId: string, list: boolean): Promise<MergedRecord[]> {
  const kabmo = await readJournalRecords(sessionId);
  const cwd = await sessionCwd(sessionId);
  const excluded = (absolute: string): boolean =>
    isExcludedTempPath(absolute, cwd ?? '') || isBuildPath(absolute, cwd ?? '');
  if (kabmo.length === 0) {
    const omp = list ? await readOmpList(sessionId) : await readOmpIndex(sessionId);
    return omp.filter((record) => !excluded(record.path)).map((record) => ({ ...record, store: 'omp' as const }));
  }

  const firstKabmoAt = kabmo[0].at;
  const omp = await readOmpIndex(sessionId);
  const merged: MergedRecord[] = [];
  for (const record of omp) {
    if (record.at >= firstKabmoAt) continue;
    if (excluded(record.path)) continue;
    merged.push({ ...record, store: 'omp' });
  }
  for (const record of kabmo) {
    if (excluded(record.path)) continue;
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
      ...(record.unavailableReason ? { unavailableReason: record.unavailableReason } : {}),
      store: 'kabmo',
    });
  }
  merged.sort((a, b) => a.at - b.at);
  return merged;
}

export function toSessionChangeRecord(record: MergedRecord): SessionChangeRecord {
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
    ...(record.existedBefore === undefined ? {} : { existedBefore: record.existedBefore }),
    ...(record.existsAfter === undefined ? {} : { existsAfter: record.existsAfter }),
  };
}

/** True when the path is still on disk; a stat error other than ENOENT counts
 *  as present, so a permission problem never hides a real change. */
export async function pathExists(absolute: string): Promise<boolean> {
  try {
    await stat(absolute);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ENOENT';
  }
}

/** True when the path is a directory now; a missing path is not one. */
export async function pathIsDirectory(absolute: string): Promise<boolean> {
  try {
    return (await stat(absolute)).isDirectory();
  } catch {
    return false;
  }
}

/** Resolve a blob key from the store that wrote it. */
export async function resolveMergedBlob(
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
