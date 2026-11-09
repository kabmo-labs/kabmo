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
 */

import { getDb } from '@/server/db.server';
import { appendQueueItem } from '@/server/lib/queue/store.server';
import { deliverQueueNow } from '@/server/lib/queue/delivery.server';
import { getSessionRelation } from '@/server/lib/sessions/relations.server';
import { isSessionArchived } from '@/server/lib/sessions/resolve.server';
import { ensureSessionLive } from '@/server/lib/sessions/dispatch.server';

export const NOTICE_WINDOW_MS = 2_000;
const OUTPUT_EXCERPT_LIMIT = 4_000;
const TRUNCATION_MARKER = '\n\n[... output truncated ...]';
const COALESCE_KEY = 'child-outcomes';

export interface ChildOutcomeNotice {
  sessionId: string;
  title?: string | null;
  status: 'completed' | 'failed' | 'interrupted';
  /** The child's final assistant text, when the transport could read it. */
  output?: string | null;
  /** Why it failed or was interrupted, when known. */
  failure?: string | null;
}

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

function describe(item: ChildOutcomeNotice): string {
  const title = item.title?.trim();
  return title ? `"${title}" (${item.sessionId})` : item.sessionId;
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function renderOutcome(item: ChildOutcomeNotice): string {
  const label = describe(item);
  if (item.status === 'completed') {
    return `Child session ${label} completed:\n\n${excerpt(item.output)}`;
  }
  const reason =
    item.status === 'interrupted'
      ? item.failure || 'it was interrupted'
      : item.failure || 'it failed';
  return `Child session ${label} ${reason}.\n\nReview the session before deciding the next step.`;
}

/** One notice body, for one child or a coalesced batch. */
export function renderChildOutcomeNotice(items: readonly ChildOutcomeNotice[]): string {
  if (items.length === 1 && items[0]) return renderOutcome(items[0]);
  const lines = items.map((item) => {
    const label = describe(item);
    if (item.status === 'completed') {
      return `- ${label} completed: ${oneLine(excerpt(item.output))}`;
    }
    return `- ${label} ${item.failure || item.status}.`;
  });
  return `Child session updates:\n\n${lines.join('\n')}`;
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
  const state = JSON.stringify(mergeOutcome(previous, outcome));
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
  if (session) await deliverQueueNow(session);
}
