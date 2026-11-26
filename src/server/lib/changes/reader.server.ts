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
import { MAX_BLOB_BYTES } from '@/server/lib/changes/blobs.server';
import { OMP_MAX_BLOB_BYTES } from '@kabmo-labs/kabmo-omp/session-changes/changes';
import { readPatchSides } from '@kabmo-labs/kabmo-omp/session-changes/changes-patch';
import {
  pathExists,
  pathIsDirectory,
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
} from '@kabmo-labs/kabmo-omp/contracts/session-changes';

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
    const beforeAbsent = first.before === null || first.existedBefore === false;
    const afterAbsent = last.after === null || last.existsAfter === false;
    if (beforeAbsent && afterAbsent) netZero.add(absolute);
  }
  // A directory recorded before the writer learned to skip them (`cp x bin/`)
  // is not a file change. The signature is a delete with no before content, so
  // only those rare paths are statted and an ordinary list stays stat-free.
  const directories = new Set<string>();
  await Promise.all(
    [...spans]
      .filter(([, { first, last }]) => first.before === undefined && last.after === null)
      .map(async ([absolute]) => {
        if (await pathIsDirectory(absolute)) directories.add(absolute);
      }),
  );
  return records
    .filter((record) => !gone.has(record.path) && !netZero.has(record.path) && !directories.has(record.path))
    .map(toSessionChangeRecord);
}

/**
 * Why one side is unknown: a key that was never stored (the record's own reason,
 * or the store's cap), versus a side the store holds but cannot produce — a
 * blob that is gone, or hunks that do not rebuild. The facts are different, and
 * the diff tab must not blame the size cap for either.
 */
function unavailableSide(
  record: MergedRecord,
  key: string | null | undefined,
): Pick<SessionChangeDiff, 'unavailableReason' | 'unavailableLimitBytes'> {
  if (record.patch) return { unavailableReason: 'unreadable' };
  if (key !== undefined) return { unavailableReason: 'unreadable' };
  if (record.unavailableReason) return { unavailableReason: record.unavailableReason };
  return {
    unavailableReason: 'too-large',
    unavailableLimitBytes: record.store === 'kabmo' ? MAX_BLOB_BYTES : OMP_MAX_BLOB_BYTES,
  };
}

/**
 * The net status of one path. A patch record states existence without content
 * (`base: null` / `sum: '-'`), so its own metadata answers before any key does.
 */
function netStatus(first: MergedRecord, last: MergedRecord): SessionChangeDiff['status'] {
  const existedBefore = first.existedBefore ?? (first.before === null ? false : undefined);
  const existsAfter = last.existsAfter ?? (last.after === null ? false : undefined);
  if (existedBefore === false) return 'added';
  if (existsAfter === false) return 'deleted';
  return 'modified';
}

/**
 * The two sides of one path's net change inside a run.
 *
 * `history` is the path's whole record list in order, because a patch record's
 * `before` may depend on its predecessor; `first`/`last` are the records that
 * own the two sides inside the window.
 */
async function netSides(
  sessionId: string,
  history: readonly MergedRecord[],
  first: MergedRecord,
  last: MergedRecord,
): Promise<{ before: string | null | undefined; after: string | null | undefined }> {
  const patched = [first, last].some((record) => record.patch && record.store === 'omp');
  const rebuilt = patched
    ? await readPatchSides(sessionId, history.map((record) => record.patch))
    : [];
  const side = (owner: MergedRecord, which: 'before' | 'after'): Promise<string | null | undefined> => {
    if (owner.patch && owner.store === 'omp') {
      return Promise.resolve(rebuilt[history.indexOf(owner)]?.[which]);
    }
    return resolveMergedBlob(sessionId, owner.store, owner[which]);
  };
  const [before, after] = await Promise.all([side(first, 'before'), side(last, 'after')]);
  return { before, after };
}

/** The net change of `absolutePath` inside `[from, to]`. */
export async function readSessionChangeDiff(
  sessionId: string,
  absolutePath: string,
  from: number,
  to: number,
): Promise<SessionChangeDiff | null> {
  const records = await readMergedRecords(sessionId, false);
  const history = records.filter((record) => record.path === absolutePath);
  const inRange = history.filter((record) => record.at >= from && record.at <= to);
  if (inRange.length === 0) return null;

  const first = inRange[0];
  const last = inRange[inRange.length - 1];
  const status = netStatus(first, last);
  const { before, after } = await netSides(sessionId, history, first, last);
  if (before === undefined || after === undefined) {
    const unknown = before === undefined
      ? unavailableSide(first, first.before)
      : unavailableSide(last, last.after);
    return {
      path: absolutePath,
      displayPath: last.displayPath,
      status,
      oldContent: '',
      newContent: '',
      diff: '',
      unavailable: true,
      ...unknown,
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
  const history = new Map<string, MergedRecord[]>();
  for (const record of records) {
    const list = history.get(record.path);
    if (list) list.push(record);
    else history.set(record.path, [record]);
  }
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
      const { before, after } = await netSides(sessionId, history.get(absolutePath) ?? [first], first, last);
      if (before === undefined || after === undefined) return;
      const sides = patchSides(unifiedDiff(absolutePath, before ?? '', after ?? ''));
      if (sides.additions === 0 && sides.deletions === 0) return;
      stats[absolutePath] = { added: sides.additions, removed: sides.deletions };
    }),
  );
  return stats;
}
