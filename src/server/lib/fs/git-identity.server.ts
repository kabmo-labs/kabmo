/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The commit identity, read where a commit is made.
 *
 * It lives in Kabmo's settings blob beside the commit-message keys, and the
 * server reads it on every commit: the Source Control panel is global, so a
 * cached read would keep an old identity alive for exactly the window the
 * operator was changing it in.
 *
 * A failed read is "repository config", never a thrown commit: a settings
 * lookup must not be the reason a commit cannot be made.
 */

import { readSettingsJson } from '@/server/lib/db/settings-store';
import { getDb } from '@/server/db.server';
import { SETTINGS_BLOB_KEY } from '@/shared/lib/settings/keys';
import {
  normalizeGitIdentities,
  selectedGitIdentity,
  type GitIdentity,
} from '@/shared/lib/git/identity';

export interface GitIdentitySettings {
  identities: GitIdentity[];
  /** '' means "repository config". */
  selectedId: string;
}

export async function readGitIdentitySettings(): Promise<GitIdentitySettings> {
  try {
    const db = await getDb();
    const blob = await readSettingsJson<Record<string, unknown> | null>(db, SETTINGS_BLOB_KEY, null);
    return {
      identities: normalizeGitIdentities(blob?.gitIdentities),
      selectedId: typeof blob?.gitCommitIdentity === 'string' ? blob.gitCommitIdentity.trim() : '',
    };
  } catch {
    return { identities: [], selectedId: '' };
  }
}

export async function readSelectedGitIdentity(): Promise<GitIdentity | null> {
  const { identities, selectedId } = await readGitIdentitySettings();
  return selectedGitIdentity(identities, selectedId);
}
