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
 * the omp reader follows. A torn final line is skipped, not fatal. The cache,
 * the file walk and the merge live in `journal-read.server.ts`; this module is
 * the public read surface.
 */

import { unifiedDiff } from '@/shared/lib/fs/unified-diff';
import { patchSides } from '@/shared/lib/fs/patch-sides';
import {
  pathExists,
  readJournalRecords,
  readMergedRecords,
  resolveMergedBlob,
  toSessionChangeRecord,
  type MergedRecord,
} from '@/server/lib/changes/journal-read.server';
import type {
  SessionChangeCounts,
  SessionChangeDiff,
  SessionChangeRecord,
} from '@/shared/types/session-changes';

/** The last record for one path, for the scan's same-content dedupe. */
export async function readSessionChangeLast(
  sessionId: string,
  absolute: string,
): Promise<{ at: number; after: string | null | undefined } | null> {
  const records = await readJournalRecords(sessionId);
  let last: (typeof records)[number] | null = null;
  for (const record of records) {
    if (record.path !== absolute) continue;
    if (!last || record.at >= last.at) last = record;
  }
  return last ? { at: last.at, after: last.after } : null;
}

/** The paths one session recorded inside `[from, to]`; the scan's cross-check. */
export async function readSessionChangePaths(
  sessionId: string,
  from: number,
  to: number,
): Promise<Set<string>> {
  const records = await readJournalRecords(sessionId);
  const paths = new Set<string>();
  for (const record of records) {
    if (record.at >= from && record.at <= to) paths.add(record.path);
  }
  return paths;
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
  // A path that did not exist before the session, was created, and was then
  // deleted has no net change. The client drops the same-run pair; this drops
  // the cross-run pair too, so the file never appears in the session's list.
  const spans = new Map<string, { first: MergedRecord; last: MergedRecord }>();
  for (const record of records) {
    const span = spans.get(record.path);
    if (span) span.last = record;
    else spans.set(record.path, { first: record, last: record });
  }
  const netZero = new Set<string>();
  for (const [absolute, { first, last }] of spans) {
    if (first.before === null && last.after === null) netZero.add(absolute);
  }
  return records
    .filter((record) => !gone.has(record.path) && !netZero.has(record.path))
    .map(toSessionChangeRecord);
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
