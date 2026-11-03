/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The review-annotation table, kept out of `db.server.ts`'s bootstrap block for
 * the same reason `schedule/schema.server.ts` is: created once per database open,
 * owned by the feature that reads it.
 *
 * Why a table and not `session_ui_state`: that blob is the CLIENT's whole
 * in-memory map, rewritten wholesale on every debounce, so two tabs (or two
 * Kabmo instances on one database) clobber each other. An annotation is a
 * judgement about a FILE and has to outlive the tab that made it.
 *
 * `block_key` is the identity — `type:hash#occurrence`, derived from the block's
 * own text — so a judgement follows its paragraph when text above it moves. The
 * line columns are display data refreshed on every save, never a join key.
 */

import type { DbClient } from '@/server/lib/db/client';

const REVIEW_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS document_annotations (
    id TEXT PRIMARY KEY,
    scope TEXT NOT NULL,
    path TEXT NOT NULL,
    block_key TEXT NOT NULL,
    line_start INTEGER NOT NULL DEFAULT 0,
    line_end INTEGER NOT NULL DEFAULT 0,
    verdict TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    quote TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE (scope, path, block_key)
  );
  CREATE INDEX IF NOT EXISTS idx_document_annotations_doc
    ON document_annotations (scope, path);
`;

/** Idempotent: the review annotations, created on every database open. */
export async function ensureReviewSchema(db: DbClient): Promise<void> {
  await db.exec(REVIEW_SCHEMA_SQL);
}
