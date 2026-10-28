/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Bootstrap-only folder ↔ omp project sync: creates a workspace folder for
 * every project discovered from ~/.omp/agent (folder name = lowercase
 * basename, bound via project_path). It never modifies or deletes existing
 * user data — no renames, no re-binding of unbound folders — and it skips
 * projects the user has explicitly deleted (tombstoned in
 * `deleted_workspaces`), so a deleted workspace stays deleted.
 *
 * **It runs ONLY while the workspace list is empty, and only ONCE per
 * database.** The list is the user's own grouping over omp projects, so a
 * non-empty one means the user (or an earlier boot) has already decided what
 * belongs there and the sync has nothing left to seed — it steps aside. The
 * once-per-database marker covers the other half of that: an empty list is
 * also what a user who deleted every folder leaves behind, and without the
 * marker the next boot refilled all 43 of them.
 *
 * This gate is what stops the phantom-workspace churn. The sync's input is
 * every session file under `~/.omp/agent/sessions`, and a session's cwd is
 * whatever directory omp was spawned in: on the machine this was written for,
 * 556 session files carried 43 distinct cwds, and 33 of them were scratch
 * directories (`/tmp/omp-*`, `/var/folders/.../T/opencode/*`, `$HOME` itself).
 * Each one that appeared *after* the list had been curated became a new folder
 * on the next boot — the delete only tombstones the paths it saw, so the next
 * scratch directory is a fresh insert. The user deleted 88 of them before this
 * gate existed, 13 of those in a single minute.
 */

import type { DbClient } from '@/server/lib/db/client';
import { projectPathKey } from '@/server/lib/omp/core/paths';
import { loadOmpSidebarData } from '@/server/lib/omp/session/reader';
import { orderedOmpProjects, projectDisplayName } from '@/shared/lib/omp/session/sidebar';

/**
 * `app_settings` key recording that the bootstrap has had its one run. Never a
 * "did it insert rows" flag: a pass that found no project must still count as
 * run, or the first session written afterwards would seed the list.
 */
const WORKSPACE_SYNC_MARKER_KEY = 'workspace_sync_ran';

/** SYNC_WORKSPACE env flag (default true when unset). When enabled in real
 *  mode, workspace folders are auto-created from discovered omp projects. */
function isWorkspaceSyncEnabled(): boolean {
  const raw = (Bun.env.SYNC_WORKSPACE || '').trim().toLowerCase();
  if (raw === '') return true;
  return raw !== 'false' && raw !== '0' && raw !== 'off' && raw !== 'no';
}

/**
 * Real-data workspace bootstrap: seed `workspace_folders` from discovered omp
 * projects when SYNC_WORKSPACE allows it, the list is still empty, AND the
 * bootstrap has never run on this database. Discovery must never block app
 * startup, so a failure is logged rather than thrown.
 *
 * Returns whether rows were inserted, so the boot banner can report the pass
 * instead of leaving an operator to wonder why the folder appeared.
 */
export async function syncWorkspaceFoldersFromDiscovery(db: DbClient): Promise<boolean> {
  if (!isWorkspaceSyncEnabled()) return false;
  try {
    return await syncWorkspaceFoldersWithOmp(db);
  } catch (err) {
    // Discovery must never block app startup.
    console.error('OMP workspace sync failed:', err);
    return false;
  }
}

/**
 * Whether the bootstrap has already run against this database. A marker rather
 * than the row count alone, because "empty" has two meanings the count cannot
 * separate: a database that has never been seeded, and one whose owner deleted
 * every folder on purpose. Without it, deleting the last workspace brought all
 * 43 discovered projects back on the next boot.
 */
async function workspaceSyncAlreadyRan(db: DbClient): Promise<boolean> {
  const row = await db.get('SELECT value FROM app_settings WHERE key = ?', [WORKSPACE_SYNC_MARKER_KEY]);
  return Boolean(row);
}

/** Record the bootstrap as spent. Written on every path that decides. */
async function markWorkspaceSyncRan(db: DbClient): Promise<void> {
  await db.run('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)', [
    WORKSPACE_SYNC_MARKER_KEY,
    new Date().toISOString(),
  ]);
}

async function syncWorkspaceFoldersWithOmp(db: DbClient): Promise<boolean> {
  const existing = await db.all('SELECT id, name, project_path FROM workspace_folders');
  // The gate: a list with anything in it is the user's, so the seed is over.
  // Counted against EVERY row, not just the bound ones — an unbound folder
  // (`Chats`, a hand-made grouping) is still a deliberate choice, and seeding
  // beside it is the same surprise.
  //
  // The marker is written HERE too, and that is the upgrade path: a database
  // that predates the marker arrives with folders and no marker, so skipping
  // without recording would leave the "user deleted every folder" hole wide
  // open for exactly the installs that have been running longest.
  if (existing.length > 0) {
    await markWorkspaceSyncRan(db);
    return false;
  }
  if (await workspaceSyncAlreadyRan(db)) return false;

  // Marked BEFORE the insert loop, and marked even when discovery yields
  // nothing: this is a one-shot bootstrap, and a pass that found no project
  // today must not become an insert the next time a session is written.
  await markWorkspaceSyncRan(db);

  const data = await loadOmpSidebarData();
  const tombstoned = await db.all('SELECT project_path FROM deleted_workspaces');

  // No `byPath` membership test: the gate above guarantees the table is empty,
  // so nothing can already match. `usedNames` still starts empty and stays
  // load-bearing WITHIN this pass — two scratch directories sharing a basename
  // (`/tmp/a/work`, `/tmp/b/work`) would otherwise both land as `work`, and the
  // sidebar's uniqueness rule is by name.
  const usedNames = new Set<string>();
  const deletedPaths = new Set(tombstoned.map((r) => projectPathKey(r.project_path as string)));

  let inserted = false;
  for (const project of orderedOmpProjects(data)) {
    if (deletedPaths.has(projectPathKey(project.path))) continue;

    const name = projectDisplayName(project);
    let candidate = name;
    let suffix = 2;
    while (usedNames.has(candidate)) {
      candidate = `${name}-${suffix++}`;
    }
    usedNames.add(candidate);
    await db.run(
      'INSERT INTO workspace_folders (name, is_expanded, project_path) VALUES (?, 1, ?)',
      [candidate, project.path],
    );
    inserted = true;
  }
  return inserted;
}
