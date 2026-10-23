/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The two worktree settings, read on the SERVER.
 *
 * They live in the `kabmo_settings` blob the settings UI writes, and a create
 * has to honour them without a round trip through the page — a scheduled task or
 * a plugin can create a worktree with no tab open.
 *
 * Absent means the default, never "off": a database written before this feature
 * has no keys at all, and the feature must behave as documented on it.
 */

import { getDb } from '@/server/db.server';
import { readSettingsBlob, SETTINGS_BLOB_KEY } from '@/shared/lib/settings/keys';
import {
  WORKTREE_CARRY_SETTING,
  WORKTREE_DIRECTORY_SETTING,
} from '@/shared/lib/fs/worktree/settings-keys';

export interface WorktreeSettings {
  /** The configured parent directory, un-resolved; `null` when unset. */
  directory: string | null;
  carryIgnored: boolean;
}

export async function readWorktreeSettings(): Promise<WorktreeSettings> {
  const fallback: WorktreeSettings = { directory: null, carryIgnored: true };
  try {
    const db = await getDb();
    const row = await db.get<{ value: string }>('SELECT value FROM app_settings WHERE key = ?', [SETTINGS_BLOB_KEY]);
    if (!row?.value) return fallback;
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.value);
    } catch {
      return fallback;
    }
    const blob = readSettingsBlob({ [SETTINGS_BLOB_KEY]: parsed });
    const directory = typeof blob[WORKTREE_DIRECTORY_SETTING] === 'string'
      ? (blob[WORKTREE_DIRECTORY_SETTING] as string)
      : null;
    const carry = blob[WORKTREE_CARRY_SETTING];
    return {
      directory: directory?.trim() ? directory.trim() : null,
      // Only an explicit `false` turns the carry off; anything else is the
      // documented default of on.
      carryIgnored: carry !== false,
    };
  } catch {
    return fallback;
  }
}