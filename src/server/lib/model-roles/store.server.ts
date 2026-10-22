/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * CRUD for model-role presets (`model_role_presets`).
 *
 * A preset is Kabmo's record of a `modelRoles` map under a name, so the user can
 * switch between whole role assignments instead of retyping every row. Applying
 * one is NOT this module's job: the route writes the map through
 * `writeModelRoles`, the same writer the individual role rows use, so a preset
 * can never produce a config shape the row editor could not.
 *
 * Two invariants:
 *   - `name` is the identity a user sees, and it is unique case-insensitively
 *     (the column is `COLLATE NOCASE UNIQUE`), so a rename onto an existing
 *     name is refused rather than silently creating a twin.
 *   - A role id is NOT narrowed to omp's built-ins. `modelRoles` accepts custom
 *     role ids (omp adds any configured role to its own role list), and dropping
 *     them here would delete a custom role the user had assigned the moment a
 *     preset was applied — the whole map is written back, so a filtered copy is
 *     a silent edit of the live config.
 */

import { getDb } from '@/server/db.server';
import { readSettingsJson, writeSettingsJson } from '@/server/lib/db/settings-store';
import { isMockMode } from '@/server/mock.server';
import { normalizeRoleMap } from '@/shared/lib/omp/config/model-roles';
import type { ModelRolePreset } from '@/shared/types/model-roles';

interface PresetRow {
  id: string;
  name: string;
  roles: string;
  created_at: number;
  updated_at: number;
}

/** Names a preset may carry: no control characters, no leading/trailing space. */
const NAME_MAX = 60;

function parseRoles(raw: string): Record<string, string> {
  try {
    return normalizeRoleMap(JSON.parse(raw));
  } catch {
    return {};
  }
}

function rowToPreset(row: PresetRow): ModelRolePreset {
  return {
    id: row.id,
    name: row.name,
    roles: parseRoles(row.roles),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Trim + validate a preset name; throws with a sentence the form can show. */
export function normalizePresetName(raw: unknown): string {
  if (typeof raw !== 'string') throw new Error('Preset name is required');
  const name = raw.trim();
  if (!name) throw new Error('Preset name is required');
  if (name.length > NAME_MAX) throw new Error(`Preset name is limited to ${NAME_MAX} characters`);
  if (/[\u0000-\u001f]/.test(name)) throw new Error('Preset name contains control characters');
  return name;
}

export async function listModelRolePresets(): Promise<ModelRolePreset[]> {
  const db = await getDb();
  const rows = (await db.all('SELECT * FROM model_role_presets ORDER BY name COLLATE NOCASE ASC')) as PresetRow[];
  return rows.map(rowToPreset);
}

export async function getModelRolePreset(id: string): Promise<ModelRolePreset | null> {
  const db = await getDb();
  const row = (await db.get('SELECT * FROM model_role_presets WHERE id = ?', [id])) as PresetRow | undefined;
  return row ? rowToPreset(row) : null;
}

/**
 * Create or update a preset. `id: null` creates; an id updates that row and
 * keeps its `created_at`. Returns the stored preset.
 *
 * A duplicate name is caught by the unique index, and the raw SQLite sentence
 * ("UNIQUE constraint failed: …") is replaced with the sentence a user can act
 * on — the route surfaces this text verbatim.
 */
export async function saveModelRolePreset(input: {
  id: string | null;
  name: unknown;
  roles: unknown;
}): Promise<ModelRolePreset> {
  const name = normalizePresetName(input.name);
  const roles = normalizeRoleMap(input.roles);
  if (Object.keys(roles).length === 0) throw new Error('A preset needs at least one role assigned');

  const db = await getDb();
  const now = Date.now();
  if (input.id) {
    const existing = await getModelRolePreset(input.id);
    if (!existing) throw new Error('Preset not found');
    try {
      await db.run(
        'UPDATE model_role_presets SET name = ?, roles = ?, updated_at = ? WHERE id = ?',
        [name, JSON.stringify(roles), now, input.id],
      );
    } catch (error) {
      throw new Error(duplicateNameMessage(error, name));
    }
    const stored = await getModelRolePreset(input.id);
    if (!stored) throw new Error('Preset not found');
    return stored;
  }

  const id = crypto.randomUUID();
  try {
    await db.run(
      'INSERT INTO model_role_presets (id, name, roles, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      [id, name, JSON.stringify(roles), now, now],
    );
  } catch (error) {
    throw new Error(duplicateNameMessage(error, name));
  }
  const stored = await getModelRolePreset(id);
  if (!stored) throw new Error('Preset not found after insert');
  return stored;
}

function duplicateNameMessage(error: unknown, name: string): string {
  const text = error instanceof Error ? error.message : String(error);
  return /UNIQUE constraint failed/i.test(text) ? `A preset named “${name}” already exists` : text;
}

/**
 * Name of the preset seeded from the roles an install already had.
 *
 * Named for what it is — the assignment the user was running before presets
 * existed — rather than after a strategy ("cheap", "thinking"), which would be a
 * claim the seeder cannot make.
 */
export const SEEDED_PRESET_NAME = 'Default';

/** `app_settings` marker: the one-shot seed has already made its decision. */
const SEED_MARKER_KEY = 'model_role_presets_seeded';

/**
 * Seed ONE preset from the `modelRoles` map an install already carries, so the
 * picker is never empty on a machine that has been running omp for months.
 *
 * One-shot, and the marker is written on EVERY path that decides — the same
 * shape `workspace_sync_ran` uses, and for the same reason: "the table is empty"
 * has two meanings a row count cannot separate (never seeded, and the user
 * deleted the seeded preset). Without the marker a delete would resurrect it on
 * the next panel open.
 *
 * Three cases step aside and still spend the run:
 *   - a map with no roles (a fresh install has nothing to snapshot);
 *   - a table that already holds a preset (including one written by hand);
 *   - MOCK mode, which must not write demo data into the database.
 *
 * A failure to insert is swallowed: a seed is a convenience, and the panel's own
 * `Save as…` is the manual path. The marker is still written, so a config that
 * omp rejects cannot make every panel open retry it.
 */
export async function seedPresetFromCurrentRoles(roles: Record<string, string>): Promise<void> {
  if (isMockMode()) return;
  const db = await getDb();
  if (await readSettingsJson<boolean>(db, SEED_MARKER_KEY, false)) return;
  const existing = await db.get<{ id: string }>('SELECT id FROM model_role_presets LIMIT 1');
  if (!existing && Object.keys(roles).length > 0) {
    try {
      await saveModelRolePreset({ id: null, name: SEEDED_PRESET_NAME, roles });
    } catch {
      // A name collision or a bad selector is not worth failing a read over.
    }
  }
  await writeSettingsJson(db, SEED_MARKER_KEY, true);
}

/** Delete a preset; returns false when the id named nothing. */
export async function deleteModelRolePreset(id: string): Promise<boolean> {
  const db = await getDb();
  const result = await db.run('DELETE FROM model_role_presets WHERE id = ?', [id]);
  return result.changes > 0;
}
