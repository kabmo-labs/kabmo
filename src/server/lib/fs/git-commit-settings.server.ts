/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The commit-message settings, read where the generation runs.
 *
 * They live in Kabmo's settings blob beside `autoSessionTitle` and the goal
 * keys, and the server reads them on every request: the Source Control panel is
 * global, so a cached read would keep an old harness alive for exactly the
 * window the operator was changing it in.
 *
 * Every value has a default and the read swallows its errors: a settings lookup
 * must never be the reason a commit message cannot be generated.
 */

import { readSettingsJson } from '@kabmo-labs/kabmo-settings-store';
import { getDb } from '@/server/db.server';
import { SETTINGS_BLOB_KEY } from '@/shared/lib/settings/keys';
import type { CommitMessageMode, CommitMessageSettings } from '@/server/lib/fs/git-commit-message.server';

const MODES: readonly CommitMessageMode[] = ['auto', 'omp', 'harness', 'off'];

export async function readCommitMessageSettings(): Promise<CommitMessageSettings> {
  try {
    const db = await getDb();
    const blob = await readSettingsJson<Record<string, unknown> | null>(db, SETTINGS_BLOB_KEY, null);
    const mode = typeof blob?.commitMessageMode === 'string'
      && MODES.includes(blob.commitMessageMode as CommitMessageMode)
      ? blob.commitMessageMode as CommitMessageMode
      : 'auto';
    return {
      mode,
      harness: typeof blob?.commitMessageHarness === 'string' ? blob.commitMessageHarness.trim() : '',
      model: typeof blob?.commitMessageModel === 'string' ? blob.commitMessageModel.trim() : '',
      prompt: typeof blob?.commitMessagePrompt === 'string' ? blob.commitMessagePrompt : '',
    };
  } catch {
    return { mode: 'auto', harness: '', model: '', prompt: '' };
  }
}
