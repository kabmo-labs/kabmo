/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Child outcomes → one message in the parent's queue.
 *
 * A turn end is the event a parent asked about, but waking it once per child
 * turns a fan-out into a notification storm: ten children finishing within a
 * second would open ten turns, each obliged to read the other nine. So outcomes
 * land in `session_notices` first, coalesce for a short window, and become ONE
 * `queued_messages` row — the queue already owns durability, retry and busy
 * handling, and a second delivery path would drift from it.
 *
 * Only a delegated child notifies. A fork has no parent edge; a child whose
 * `parentNotifications` is `off` or whose outcome is filtered by `stuck` writes
 * nothing.
 *
 * The TEXT is built by `renderChildOutcomeNotice` in shared code, because the
 * timeline parses the same envelope back into a card. A second copy of the
 * format here would drift the moment either side changed.
 */

import { getDb } from '@/server/db.server';
import { appendQueueItem } from '@/server/lib/queue/store.server';
import { deliverQueueNow } from '@/server/lib/queue/delivery.server';
import { getSessionRelation } from '@/server/lib/sessions/relations.server';
import { isSessionArchived } from '@/server/lib/sessions/resolve.server';
import { ensureSessionLive } from '@/server/lib/sessions/dispatch.server';
import { findSessionFileById } from '@/server/lib/omp/session/locator';
import { loadSessionTitle } from '@kabmo-labs/kabmo-omp-session-messages/messages';
import {
  renderChildOutcomeNotice,
  type ChildOutcomeEntry,
} from '@/shared/lib/chat/orchestration/notice';

export const NOTICE_WINDOW_MS = 2_000;
const OUTPUT_EXCERPT_LIMIT = 4_000;
const TRUNCATION_MARKER = '\n\n[... output truncated ...]';
const COALESCE_KEY = 'child-outcomes';

export type ChildOutcomeNotice = ChildOutcomeEntry;

interface NoticeRow {
  id: string;
  parent_session_id: string;
  coalesce_key: string;
  state: string;
  send_at: number;
}

declare global {
  // eslint-disable-next-line no-var
  var __kabmoNoticeTimers: Map<string, ReturnType<typeof setTimeout>> | undefined;
}

function timers(): Map<string, ReturnType<typeof setTimeout>> {
  globalThis.__kabmoNoticeTimers ??= new Map();
  return globalThis.__kabmoNoticeTimers;
}

function excerpt(text: string | null | undefined): string {
  const trimmed = text?.trim();
  if (!trimmed) return 'No final output was recorded.';
  if (trimmed.length <= OUTPUT_EXCERPT_LIMIT) return trimmed;
  const keep = Math.max(0, OUTPUT_EXCERPT_LIMIT - TRUNCATION_MARKER.length);
  return `${trimmed.slice(0, keep).trimEnd()}${TRUNCATION_MARKER}`;
}

/** The child's own title, so the coordinator reads a name instead of a UUID.
 *  Best-effort: an ACP child has no omp file, and a missing title is not a
 *  reason to withhold the outcome. */
async function titleOf(sessionId: string): Promise<string | null> {
  try {
    const file = await findSessionFileById(sessionId);
    if (!file) return null;
    const title = (await loadSessionTitle(file))?.trim();
    // A worker's first prompt is Kabmo's own brief, so an auto-title derived
    // from it is the brief's first line — measured as
    // `title: [kabmo dispatched worker]` in a real coordinator's notice. That
    // names nothing; the session id below it already identifies the worker.
    if (!title || /^\[kabmo /.test(title)) return null;
    return title;
  } catch {
    return null;
  }
}

function mergeOutcome(
  previous: readonly ChildOutcomeNotice[],
  next: ChildOutcomeNotice,
): ChildOutcomeNotice[] {
  const index = previous.findIndex((item) => item.sessionId === next.sessionId);
  if (index === -1) return [...previous, next];
  return previous.map((item, position) => (position === index ? next : item));
}

function shouldNotify(
  status: ChildOutcomeNotice['status'],
  preference: 'auto' | 'stuck' | 'off',
): boolean {
  if (preference === 'off') return false;
  if (preference === 'stuck') return status !== 'completed';
  return true;
}

/**
 * Record one outcome, coalescing it into the parent's open window.
 *
 * Best-effort by contract: this runs from a turn-settle hook, and a database
 * failure must not turn a finished turn into a failed one. The caller wraps it.
 */
export async function noteChildOutcome(outcome: ChildOutcomeNotice): Promise<void> {
  const relation = await getSessionRelation(outcome.sessionId);
  if (!relation?.parentSessionId || relation.originKind !== null) return;
  if (!shouldNotify(outcome.status, relation.parentNotifications)) return;

  const parentSessionId = relation.parentSessionId;
  if (await isSessionArchived(parentSessionId)) return;

  const db = await getDb();
  const now = Date.now();
  const sendAt = now + NOTICE_WINDOW_MS;
  const existing = await db.get<NoticeRow>(
    'SELECT * FROM session_notices WHERE parent_session_id = ? AND coalesce_key = ?',
    [parentSessionId, COALESCE_KEY],
  );
  const previous = existing
    ? (JSON.parse(existing.state) as ChildOutcomeNotice[])
    : [];
  const entry: ChildOutcomeNotice = {
    ...outcome,
    title: outcome.title ?? (await titleOf(outcome.sessionId)),
    output: outcome.status === 'completed' ? excerpt(outcome.output) : null,
  };
  const state = JSON.stringify(mergeOutcome(previous, entry));
  await db.run(
    `INSERT INTO session_notices
       (id, parent_session_id, coalesce_key, state, send_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(parent_session_id, coalesce_key) DO UPDATE SET
       state = excluded.state,
       send_at = excluded.send_at,
       updated_at = excluded.updated_at`,
    [crypto.randomUUID(), parentSessionId, COALESCE_KEY, state, sendAt, now, now],
  );

  clearTimeout(timers().get(parentSessionId));
  timers().set(
    parentSessionId,
    setTimeout(() => {
      timers().delete(parentSessionId);
      void flushNotice(parentSessionId).catch((error) => {
        console.error(
          `[sessions] could not deliver child outcomes to ${parentSessionId}:`,
          error instanceof Error ? error.message : error,
        );
      });
    }, NOTICE_WINDOW_MS),
  );
}

/** Drop a pending window without materialising it (tests and session purge). */
export function cancelNoticeTimer(parentSessionId: string): void {
  clearTimeout(timers().get(parentSessionId));
  timers().delete(parentSessionId);
}

/**
 * Turn an open window into one queue row, without waking the parent.
 *
 * Split from `flushNotice` so a test can prove the merge and the text without
 * spawning a process. Returns null when another caller already claimed it.
 */
export async function materializeNotice(parentSessionId: string): Promise<string | null> {
  const db = await getDb();
  const row = await db.get<NoticeRow>(
    'SELECT * FROM session_notices WHERE parent_session_id = ? AND coalesce_key = ?',
    [parentSessionId, COALESCE_KEY],
  );
  if (!row) return null;
  // The DELETE is the claim: two timers (a hot reload, a second instance)
  // cannot both turn one window into two queue rows.
  const claimed = await db.run(
    'DELETE FROM session_notices WHERE parent_session_id = ? AND coalesce_key = ?',
    [parentSessionId, COALESCE_KEY],
  );
  if (claimed.changes === 0) return null;

  const items = JSON.parse(row.state) as ChildOutcomeNotice[];
  if (items.length === 0) return null;
  const text = renderChildOutcomeNotice(items);
  await appendQueueItem(parentSessionId, { text });
  return text;
}

/** Materialize the window, then make sure the parent is awake to read it. */
export async function flushNotice(parentSessionId: string): Promise<void> {
  const text = await materializeNotice(parentSessionId);
  if (text === null) return;
  const session = await ensureSessionLive(parentSessionId);
  if (!session) {
    // The row is durable and the parent's queue panel shows it, but nothing
    // will deliver it until that session can be resumed. Say so: a coordinator
    // that never hears from a worker is otherwise indistinguishable from one
    // that is still working.
    console.error(
      `[sessions] child outcomes for ${parentSessionId} are queued but the session could not be resumed`,
    );
    return;
  }
  await deliverQueueNow(session);
}

/**
 * Deliver every notice a PREVIOUS process left behind.
 *
 * The window lives in a timer, and a timer dies with the process: a child that
 * finished during a restart (or a `bun --hot` reload) left its outcome in
 * `session_notices` with nothing to flush it, so the coordinator waited for a
 * message that was already written. Runs once, after the listener is up.
 */
export async function drainPendingNotices(): Promise<void> {
  const db = await getDb();
  const rows = await db.all<{ parent_session_id: string }>(
    'SELECT DISTINCT parent_session_id FROM session_notices',
  );
  for (const row of rows) {
    await flushNotice(row.parent_session_id).catch((error) => {
      console.error(
        `[sessions] could not deliver a stranded child outcome to ${row.parent_session_id}:`,
        error instanceof Error ? error.message : error,
      );
    });
  }
}
