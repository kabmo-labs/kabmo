/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The chat's per-run file list, read from the session's agent change journal.
 *
 *   GET /api/sessions/:sessionId/changes
 *     Every `change` record, oldest first, with a display path. No blob
 *     content: the client buckets records into runs and only asks for a diff
 *     when a file is clicked. A creation whose file is gone is dropped — a
 *     `bash rm` never reaches the journal, so the run's list would otherwise
 *     count a file that no longer exists.
 *
 *   GET /api/sessions/:sessionId/changes/diff?path=<abs>&from=<ms>&to=<ms>
 *     The net change of one path inside one run window: the first record's
 *     `before` and the last record's `after`, plus a unified patch.
 *
 *   GET /api/sessions/:sessionId/changes/stats?from=<ms>&to=<ms>
 *     The same net change as `+`/`−` line counts for every path in the window,
 *     so the run's file summary can print the totals without opening a diff.
 *
 * A session with no journal (older omp, or no artifacts directory) answers an
 * empty list — a normal state, not an error. The diff read answers 404 when the
 * path has no record in the range, so a stale click reports the real problem.
 */

import { json } from '@/server/lib/remix-compat';
import type { LoaderFunctionArgs } from '@/server/lib/remix-compat';
import { isSinglePathSegment } from '@/server/lib/fs/path-segment';
import { readSessionChangeDiff, readSessionChangeList, readSessionChangeStats } from '@/server/lib/changes/reader.server';

/** GET /api/sessions/:sessionId/changes */
export async function getSessionChanges({ params }: LoaderFunctionArgs) {
  const sessionId = params.sessionId;
  if (!sessionId) return json({ error: 'Missing session id' }, { status: 400 });
  if (!isSinglePathSegment(sessionId)) return json({ error: 'Session not found' }, { status: 404 });
  return json({ sessionId, records: await readSessionChangeList(sessionId) });
}

/** GET /api/sessions/:sessionId/changes/diff */
export async function getSessionChangeDiff({ params, request }: LoaderFunctionArgs) {
  const sessionId = params.sessionId;
  if (!sessionId) return json({ error: 'Missing session id' }, { status: 400 });
  if (!isSinglePathSegment(sessionId)) return json({ error: 'Session not found' }, { status: 404 });

  const url = new URL(request.url);
  const file = url.searchParams.get('path');
  const fromRaw = url.searchParams.get('from');
  const toRaw = url.searchParams.get('to');
  const from = fromRaw === null ? Number.NaN : Number(fromRaw);
  const to = toRaw === null ? Number.NaN : Number(toRaw);
  if (!file || !Number.isFinite(from) || !Number.isFinite(to)) {
    return json({ error: 'path, from and to are required' }, { status: 400 });
  }

  const diff = await readSessionChangeDiff(sessionId, file, from, to);
  if (!diff) return json({ error: 'No change for that path in the range' }, { status: 404 });
  return json({ success: true, ...diff });
}

/** GET /api/sessions/:sessionId/changes/stats */
export async function getSessionChangeStats({ params, request }: LoaderFunctionArgs) {
  const sessionId = params.sessionId;
  if (!sessionId) return json({ error: 'Missing session id' }, { status: 400 });
  if (!isSinglePathSegment(sessionId)) return json({ error: 'Session not found' }, { status: 404 });

  const url = new URL(request.url);
  const fromRaw = url.searchParams.get('from');
  const toRaw = url.searchParams.get('to');
  const from = fromRaw === null ? Number.NaN : Number(fromRaw);
  const to = toRaw === null ? Number.NaN : Number(toRaw);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) {
    return json({ error: 'from and to are required' }, { status: 400 });
  }

  return json({ sessionId, files: await readSessionChangeStats(sessionId, from, to) });
}
