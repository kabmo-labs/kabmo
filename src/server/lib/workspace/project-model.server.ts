/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The default model a NEW chat inherits from the workspace it starts in.
 *
 * "Defaults for new chats" on a project is only a setting if the spawn reads
 * it. The spawn used to fall back to Kabmo's global persisted pick and nothing
 * else, so the project's model column rendered in the settings pane and in the
 * sidebar payload while every chat actually started on the global pick — a
 * control that promised something it never decided.
 *
 * Resolution is by the spawn's cwd, compared the way the sidebar compares
 * folders: the row holds the spelling the user registered, while the composer
 * may hand over a worktree or a symlinked path of the same project.
 */

import type { DbClient } from '@/server/lib/db/client';
import { projectPathKey } from '@/server/lib/omp/core/paths';
import { parseProjectModel } from '@/shared/lib/workspace/project-model';
import type { SelectedModel } from '@/shared/types';

export async function projectModelForCwd(db: DbClient, cwd: string | null | undefined): Promise<SelectedModel | null> {
  if (!cwd || !cwd.trim()) return null;

  const rows = await db.all<{ model: string | null; project_path: string | null }>(
    'SELECT model, project_path FROM workspace_folders WHERE project_path IS NOT NULL ORDER BY length(project_path) DESC',
  );
  if (rows.length === 0) return null;

  const target = projectPathKey(cwd);
  const exact = rows.find((row) => row.project_path && projectPathKey(row.project_path) === target);
  if (exact) return parseProjectModel(exact.model);

  // A linked checkout runs outside its project root, and its own path is not
  // registered — so the nearest bound root that CONTAINS it is the folder the
  // chat belongs to. Longest first, so a project nested inside another
  // workspace resolves to the more specific one.
  const nested = rows.find((row) => {
    if (!row.project_path) return false;
    const root = projectPathKey(row.project_path);
    return target.startsWith(`${root}/`);
  });
  return nested ? parseProjectModel(nested.model) : null;
}
