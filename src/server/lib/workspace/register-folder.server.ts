/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Insert one workspace folder row, with the side effects every creation path
 * owes.
 *
 * Two routes create a workspace — `POST /api/folders` (the user named a
 * directory) and `POST /api/folders/clone` (a repository was cloned into one)
 * — and the parts that matter are the ones a second copy gets wrong:
 *
 * - **The name is unique case-insensitively.** The sidebar lists folders by
 *   name, so a second `ompchamber` beside the first is indistinguishable.
 * - **A tombstone for the same project path is cleared.** `deleted_workspaces`
 *   remembers a removed folder so the omp discovery sync does not resurrect
 *   it; re-adding that path by hand is the user overriding the tombstone, and
 *   leaving it would make the folder vanish on the next boot. Cleared by
 *   CANONICAL key, because a tombstone may hold the unresolved spelling of the
 *   same directory (`/var/...` vs `/private/var/...` on macOS).
 * - **The skill-discovery watcher set grows with the folder.** A new workspace
 *   brings its own `.omp/skills` into scope; without the sync a skill created
 *   there stays invisible to a live session until the server restarts.
 * - **The sidebar is told.** A folder is structure, so the signal is what
 *   republishes the list to every open tab.
 */

import type { DbClient } from '@/server/lib/db/client';
import { projectPathKey } from '@/server/lib/omp/core/paths';
import { syncDiscoveryRootsWatch } from '@/server/lib/omp/config/roots-watch.server';
import { emitRealtimeSignal } from '@/server/lib/realtime/signals.server';

export type RegisterFolderResult =
  | { ok: true; id: number; name: string }
  | { ok: false; code: 'duplicate_name'; error: string };

/**
 * The name a folder is listed under when the caller did not supply one: the
 * directory's basename, lowercased, so a path-only request still yields a name
 * the user recognizes.
 */
export function defaultFolderName(projectPath: string): string {
  const withoutTrailing = projectPath.replace(/[\\/]+$/, '');
  return (withoutTrailing.split(/[\\/]/).pop() ?? '').toLowerCase();
}

export async function registerWorkspaceFolder(
  db: DbClient,
  input: { name: string; projectPath: string | null },
): Promise<RegisterFolderResult> {
  const existing = await db.get('SELECT id FROM workspace_folders WHERE lower(name) = lower(?)', [input.name]);
  if (existing) {
    return { ok: false, code: 'duplicate_name', error: 'A workspace with this name already exists' };
  }

  if (input.projectPath) {
    const target = projectPathKey(input.projectPath);
    const tombstones = await db.all<{ project_path: string | null }>(
      'SELECT project_path FROM deleted_workspaces',
    );
    for (const row of tombstones) {
      if (typeof row.project_path !== 'string') continue;
      if (projectPathKey(row.project_path) !== target) continue;
      await db.run('DELETE FROM deleted_workspaces WHERE project_path = ?', [row.project_path]);
    }
  }

  const result = await db.run(
    'INSERT INTO workspace_folders (name, is_expanded, project_path) VALUES (?, 1, ?)',
    [input.name, input.projectPath],
  );

  void syncDiscoveryRootsWatch();
  emitRealtimeSignal('sidebar-structure');

  return { ok: true, id: result.lastID, name: input.name };
}
