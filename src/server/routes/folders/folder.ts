import { json } from '@/server/lib/remix-compat';
import type { ActionFunctionArgs } from '@/server/lib/remix-compat';
import { methodNotAllowed } from '@/server/lib/route-adapter';
import { getDb } from '@/server/db.server';
import { deleteWorkspaceFolder, parseFolderSettingsPatch, updateWorkspaceFolder } from '@/shared/lib/workspace/project-settings';
import { revealInFileManager } from '@/server/lib/fs/reveal';
import { syncDiscoveryRootsWatch } from '@/server/lib/omp/config/roots-watch.server';
import { emitRealtimeSignal } from '@/server/lib/realtime/signals.server';

export async function pinFolder({ request, params }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return methodNotAllowed({ request, params });
  }

  const db = await getDb();
  const folderId = params.folderId;
  const formData = await request.formData();

  const isPinned = formData.get('isPinned') === 'true' ? 1 : 0;

  await db.run('UPDATE workspace_folders SET is_pinned = ? WHERE id = ?', [isPinned, folderId]);
  // Pinning reorders the sidebar: the list is the sidebar's own structure.
  emitRealtimeSignal('sidebar-structure');

  return json({ success: true, isPinned });
}

export async function toggleFolder({ request, params }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return methodNotAllowed({ request, params });
  }

  const db = await getDb();
  const folderId = params.folderId;
  const formData = await request.formData();

  const isExpanded = formData.get('isExpanded') === 'true' ? 1 : 0;

  await db.run('UPDATE workspace_folders SET is_expanded = ? WHERE id = ?', [isExpanded, folderId]);
  // The expansion flag rides the sidebar's folder rows, so a toggle is a
  // structure change like any other.
  emitRealtimeSignal('sidebar-structure');

  return json({ success: true, isExpanded });
}

/**
 * POST /api/folders/:folderId/open — reveal the workspace's directory in the
 * platform file manager.
 *
 * The path comes from the row the id names, never from the request: a client
 * that could send one would have an arbitrary-path opener.
 */
export async function openFolder({ request, params }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return methodNotAllowed({ request, params });
  }

  const folderId = params.folderId;
  if (!folderId) return json({ error: 'folderId is required' }, { status: 400 });

  const db = await getDb();
  const folder = await db.get('SELECT project_path FROM workspace_folders WHERE id = ?', [folderId]);
  if (!folder) return json({ error: 'Workspace not found' }, { status: 404 });
  if (!folder.project_path) {
    // An unbound folder has no directory of its own — it is a grouping, not a
    // path — so there is nothing to open and the menu must say so.
    return json({ error: 'This workspace is not bound to a directory' }, { status: 400 });
  }

  const result = await revealInFileManager(folder.project_path);
  return result.ok
    ? json({ success: true })
    : json({ error: result.error }, { status: 500 });
}

export async function deleteFolder({ request, params }: ActionFunctionArgs) {
  if (request.method !== 'POST' && request.method !== 'DELETE') {
    return methodNotAllowed({ request, params });
  }

  const db = await getDb();
  const folderId = params.folderId;

  const deleted = await deleteWorkspaceFolder(db, folderId || '');
  if (!deleted) return json({ error: 'Workspace not found' }, { status: 404 });

  // The removed workspace's `.omp` roots leave scope with it, so the discovery
  // watcher set has to shrink — a lingering watcher would keep broadcasting
  // reloads for a tree Kabmo no longer reads.
  void syncDiscoveryRootsWatch();
  emitRealtimeSignal('sidebar-structure');

  return json({ success: true });
}

export async function updateFolderSettings({ request, params }: ActionFunctionArgs) {
  if (request.method !== 'POST' && request.method !== 'PATCH') {
    return methodNotAllowed({ request, params });
  }

  const folderId = params.folderId;
  if (!folderId) return json({ error: 'folderId is required' }, { status: 400 });

  let body: unknown;
  try {
    body = await request.json();
  } catch (error) {
    return json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const db = await getDb();
  const patch = parseFolderSettingsPatch(body);
  const updated = await updateWorkspaceFolder(db, folderId, patch);
  if (!updated) {
    const folder = await db.get('SELECT id FROM workspace_folders WHERE id = ?', [folderId]);
    if (!folder) return json({ error: 'Workspace not found' }, { status: 404 });
    return json({ success: true, changed: false });
  }

  // A settings patch can rename or re-icon the folder, so the sidebar re-reads.
  emitRealtimeSignal('sidebar-structure');
  return json({ success: true, changed: true });
}
