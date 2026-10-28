/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Model-role preset schema, in its own module for the reason
 * `schedule/schema.server.ts` and `btw/schema.server.ts` are: it is created on
 * every database open, and the feature that reads it owns the DDL.
 *
 * The preset's whole `modelRoles` map is ONE JSON column rather than a row per
 * role. A preset is a SNAPSHOT applied as a unit — the same semantics as omp's
 * own `/modelpreset switch`, which re-applies the saved roles "as a whole" — so
 * a per-role table would have to express an operation that does not exist.
 *
 * `name` is UNIQUE with `COLLATE NOCASE`: a user who saves "Fast" twice means
 * the same preset, and two rows differing only in case would be two entries the
 * picker cannot tell apart.
 */

import type { DbClient } from '@/server/lib/db/client';

const MODEL_ROLE_PRESET_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS model_role_presets (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL COLLATE NOCASE UNIQUE,
    roles TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
`;

/** Idempotent: the role-preset table, created on every database open. */
export async function ensureModelRolePresetSchema(db: DbClient): Promise<void> {
  await db.exec(MODEL_ROLE_PRESET_SCHEMA_SQL);
}
