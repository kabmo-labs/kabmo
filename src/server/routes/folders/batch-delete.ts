/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * POST /api/folders/batch-delete — unregister several workspaces in one request.
 *
 * Same semantics as `POST /api/folders/:folderId/delete`, which is what the
 * workspace's own `⋯` menu performs: the sidebar registration goes, and a bound
 * folder is tombstoned so the omp-project sync cannot re-add it on the next
 * boot. Transcript files are NOT touched — removing a workspace has never meant
 * removing the sessions on disk, and the sessions are separately selectable in
 * the sidebar's session mode when that IS what the user wants.
 *
 * One request rather than N because a batch delete is one user action, and the
 * confirmation dialog should report one summary instead of N answers.
 */

import { json } from '@/server/lib/remix-compat';
import type { ActionFunctionArgs } from '@/server/lib/remix-compat';
import { methodNotAllowed, parseJsonBody } from '@/server/lib/route-adapter';
import { getDb } from '@/server/db.server';
import { deleteWorkspaceFolder } from '@/shared/lib/workspace/project-settings';
import { syncDiscoveryRootsWatch } from '@/server/lib/omp/config/roots-watch.server';
import { emitRealtimeSignal } from '@/server/lib/realtime/signals.server';

const MAX_BATCH = 200;

export async function batchDeleteFolders({ request }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return methodNotAllowed({ request, params: {} });
  }

  const parsed = await parseJsonBody<{ ids?: unknown }>(request);
  if (!parsed.ok) return json({ error: 'Invalid JSON body' }, { status: 400 });

  const raw = parsed.body.ids;
  if (!Array.isArray(raw) || raw.some((id) => typeof id !== 'string' || id.length === 0)) {
    return json({ error: 'ids must be an array of workspace ids' }, { status: 400 });
  }
  const ids = [...new Set(raw as string[])];
  if (ids.length === 0) return json({ error: 'No workspaces selected' }, { status: 400 });
  if (ids.length > MAX_BATCH) {
    return json({ error: `At most ${MAX_BATCH} workspaces can be deleted at once.` }, { status: 400 });
  }

  const db = await getDb();
  const removed: string[] = [];
  const refused: { id: string; error: string; code?: string }[] = [];

  for (const id of ids) {
    // `deleteWorkspaceFolder` answers false for an id that is not a folder, and
    // takes the id as a bound parameter — there is no path built from it here.
    const deleted = await deleteWorkspaceFolder(db, id);
    if (deleted) removed.push(id);
    else refused.push({ id, error: 'Workspace not found', code: 'not_found' });
  }

  // One watcher reconcile and one republish for the whole batch: the removed
  // folders' `.omp` roots leave scope together, and the sidebar re-reads once.
  if (removed.length > 0) {
    void syncDiscoveryRootsWatch();
    emitRealtimeSignal('sidebar-structure');
  }

  return json({ success: refused.length === 0, removed, refused });
}
