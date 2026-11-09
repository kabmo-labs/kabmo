/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The three tables that make a session part of a tree.
 *
 * A session has no canonical row: an omp chat is a JSONL file and an ACP chat
 * is owned by the agent (`harness_sessions` records only who ran it). So the
 * relationships live here, keyed by the id the sidebar and the URL use, and
 * they survive a restart, a closed tab and a second Kabmo instance.
 *
 * `session_relations` carries three independent edges and no more:
 *
 *   parent_session_id          the sidebar tree and the outcome notification
 *   lifecycle_owner_session_id archive/delete ownership (may cross projects)
 *   source_session_id          a fork's origin, with `origin_kind = 'fork'`
 *
 * `session_notices` is the coalescing buffer between a finishing child and the
 * parent's queue; a row exists only inside the window and becomes one
 * `queued_messages` row when it closes. It is deliberately NOT a row in the
 * queue: the queue is the user's editable follow-up list and a system notice
 * has no business being reordered or edited.
 */

import type { DbClient } from '@/server/lib/db/client';

const SESSION_RELATIONS_SQL = `
  CREATE TABLE IF NOT EXISTS session_relations (
    session_id                 TEXT PRIMARY KEY,
    parent_session_id          TEXT,
    lifecycle_owner_session_id TEXT,
    source_session_id          TEXT,
    origin_kind                TEXT,
    visibility                 TEXT NOT NULL DEFAULT 'visible',
    parent_notifications       TEXT NOT NULL DEFAULT 'auto',
    depth                      INTEGER NOT NULL DEFAULT 0,
    created_at                 INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_session_relations_parent
    ON session_relations (parent_session_id);
  CREATE INDEX IF NOT EXISTS idx_session_relations_owner
    ON session_relations (lifecycle_owner_session_id);
  CREATE INDEX IF NOT EXISTS idx_session_relations_source
    ON session_relations (source_session_id, origin_kind);

  CREATE TABLE IF NOT EXISTS session_notices (
    id                TEXT PRIMARY KEY,
    parent_session_id TEXT NOT NULL,
    coalesce_key      TEXT NOT NULL,
    state             TEXT NOT NULL,
    send_at           INTEGER NOT NULL,
    created_at        INTEGER NOT NULL,
    updated_at        INTEGER NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_session_notices_window
    ON session_notices (parent_session_id, coalesce_key);

  CREATE TABLE IF NOT EXISTS session_agent_tokens (
    session_id TEXT PRIMARY KEY,
    token_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    revoked_at INTEGER
  );

  -- The last assistant text an ACP turn closed. ACP history is agent-owned:
  -- there is no transcript for /api/chat/:id to read after the process dies,
  -- so the parent notice and 'kabmo session output' would otherwise lose the
  -- answer. omp does not need this row (its JSONL is the record), but writing
  -- both keeps the read path one rule.
  CREATE TABLE IF NOT EXISTS session_answers (
    session_id TEXT PRIMARY KEY,
    answer     TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
`;

/** Idempotent: created on every database open, like every other feature table. */
export async function ensureSessionRelationsSchema(db: DbClient): Promise<void> {
  await db.exec(SESSION_RELATIONS_SQL);
}
