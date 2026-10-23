/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The `worktrees` table: one row per worktree Kabmo created.
 *
 * Everything a worktree row shows is read from git — except two things this
 * table is the only home for:
 *
 *  - **`start_ref`**, the ref the branch was created from. `aheadOfStart` gates
 *    the delete dialog's branch checkbox, and git cannot answer it later: the
 *    branch has moved on, and for an existing-branch worktree there was no start
 *    ref at all.
 *  - **`project_id`**, the repository's identity, which is what the default
 *    root is keyed by. It is a CACHE, not a derivation result: the derivation
 *    moves when a repository gains an unrelated root commit (see
 *    `worktree/project-id.ts`), so a stored value always wins.
 */

import type { DbClient } from '@/server/lib/db/client';

const WORKTREE_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS worktrees (
    path TEXT PRIMARY KEY,
    primary_root TEXT NOT NULL,
    project_id TEXT NOT NULL,
    branch TEXT NOT NULL,
    start_ref TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_worktrees_primary ON worktrees (primary_root);
`;

export interface WorktreeRow {
  path: string;
  primary_root: string;
  project_id: string;
  branch: string;
  start_ref: string;
  created_at: string;
}

/** Idempotent: the worktree registry, created on every database open. */
export async function ensureWorktreeSchema(db: DbClient): Promise<void> {
  await db.exec(WORKTREE_SCHEMA_SQL);
}

/**
 * The identity cache: the project id already recorded for this repository.
 * `LIMIT 1` because every row of one repository carries the same value.
 */
export async function worktreeIdentityFor(db: DbClient, primaryRoot: string): Promise<string | null> {
  try {
    const row = await db.get<{ project_id: string }>(
      'SELECT project_id FROM worktrees WHERE primary_root = ? LIMIT 1',
      [primaryRoot],
    );
    return typeof row?.project_id === 'string' && row.project_id ? row.project_id : null;
  } catch {
    // A database that cannot answer is not a reason to refuse the operation:
    // the derivation still gives a usable key.
    return null;
  }
}

export async function worktreeRowFor(db: DbClient, worktreePath: string): Promise<WorktreeRow | undefined> {
  return db.get<WorktreeRow>('SELECT * FROM worktrees WHERE path = ?', [worktreePath]);
}

export async function listWorktreeRows(db: DbClient, primaryRoot: string): Promise<WorktreeRow[]> {
  return db.all<WorktreeRow>('SELECT * FROM worktrees WHERE primary_root = ?', [primaryRoot]);
}

export async function putWorktreeRow(db: DbClient, row: WorktreeRow): Promise<void> {
  await db.run(
    `INSERT INTO worktrees (path, primary_root, project_id, branch, start_ref, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(path) DO UPDATE SET
       primary_root = excluded.primary_root,
       project_id = excluded.project_id,
       branch = excluded.branch,
       start_ref = excluded.start_ref`,
    [row.path, row.primary_root, row.project_id, row.branch, row.start_ref, row.created_at],
  );
}

export async function removeWorktreeRow(db: DbClient, worktreePath: string): Promise<void> {
  await db.run('DELETE FROM worktrees WHERE path = ?', [worktreePath]);
}