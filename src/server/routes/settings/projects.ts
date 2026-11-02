import { json } from '@/server/lib/remix-compat';
import type { ActionFunctionArgs, LoaderFunctionArgs } from '@/server/lib/remix-compat';
import { methodNotAllowed } from '@/server/lib/route-adapter';
import { getDb } from '@/server/db.server';
import { PROJECT_ACCENT_OPTIONS } from '@/shared/lib/workspace/project-accent';
import { deleteWorkspaceFolder, projectConfigFromFolder, updateWorkspaceFolder } from '@/shared/lib/workspace/project-settings';
import { isRecord } from '@/shared/lib/util/guards';
import { emitRealtimeSignal } from '@/server/lib/realtime/signals.server';
import { syncDiscoveryRootsWatch } from '@/server/lib/omp/config/roots-watch.server';
import { prepareProjectPatch } from '@/server/lib/workspace/project-patch.server';

/**
 * The fields this route accepts from a project form. Anything else in the body
 * (an `id`, a `path` read back from the list) is derived from the row: `path` is
 * the API's name for `project_path`, and a client echoing the whole project back
 * must not be able to write a column through a synonym.
 *
 * The default model is NOT served from here. It is one of `provider:modelId`
 * from the live catalog (`/api/models`), and this route used to answer with a
 * hardcoded list of display names that no session could ever start on.
 */
function projectPatchBody(project: Record<string, unknown>): Record<string, unknown> {
  return {
    name: project.name,
    projectPath: project.projectPath ?? project.path,
    model: project.model,
    accentColor: project.accentColor,
    icon: project.icon,
    customIconUrl: project.customIconUrl,
    isPinned: project.isPinned,
    isExpanded: project.isExpanded,
  };
}

export async function loader({ request: _request }: LoaderFunctionArgs) {
  try {
    const db = await getDb();
    const folders = await db.all('SELECT * FROM workspace_folders ORDER BY id ASC');
    return json({
      projects: folders.map(projectConfigFromFolder),
      accentColorOptions: PROJECT_ACCENT_OPTIONS,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load projects';
    return json({
      error: message,
      projects: [],
      accentColorOptions: PROJECT_ACCENT_OPTIONS,
    }, { status: 500 });
  }
}

export async function action({ request, params }: ActionFunctionArgs) {
  const db = await getDb();

  if (request.method === 'DELETE') {
    const id = new URL(request.url).searchParams.get('id');
    const folderId = id?.startsWith('folder-') ? id.slice('folder-'.length) : id;
    if (!folderId) return json({ error: 'id is required' }, { status: 400 });

    const deleted = await deleteWorkspaceFolder(db, folderId);
    if (!deleted) return json({ error: 'Workspace not found' }, { status: 404 });
    // The removed workspace's `.omp` roots leave scope with it; a lingering
    // watcher would keep broadcasting reloads for a tree Kabmo no longer reads.
    void syncDiscoveryRootsWatch();
    emitRealtimeSignal('sidebar-structure');
    return json({ success: true });
  }

  if (request.method !== 'POST' && request.method !== 'PUT' && request.method !== 'PATCH') {
    return methodNotAllowed({ request, params });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch (error) {
    return json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!isRecord(body) || !isRecord(body.project)) {
    return json({ error: 'project is required' }, { status: 400 });
  }

  const project = body.project;
  const folderId = typeof project.folderId === 'number' ? String(project.folderId) : undefined;
  if (!folderId) return json({ error: 'project.folderId is required' }, { status: 400 });

  const before = await db.get<{ project_path: string | null }>(
    'SELECT project_path FROM workspace_folders WHERE id = ?',
    [folderId],
  );
  if (!before) return json({ error: 'Workspace not found' }, { status: 404 });

  const prepared = await prepareProjectPatch(db, folderId, projectPatchBody(project));
  if (!prepared.ok) {
    return json({ error: prepared.error, ...(prepared.code ? { code: prepared.code } : {}) }, { status: prepared.status });
  }

  const patch = prepared.patch;
  const updated = await updateWorkspaceFolder(db, folderId, patch);
  const folder = await db.get('SELECT * FROM workspace_folders WHERE id = ?', [folderId]);

  const pathChanged = patch.projectPath !== undefined && (folder?.project_path ?? null) !== before.project_path;
  if (pathChanged) {
    // The watched discovery-root set is keyed by `project_path`, so a re-bind
    // has to re-sync it: without this the OLD root stayed watched and the new
    // one was never added until a restart.
    void syncDiscoveryRootsWatch();
  }

  // A project field (name, model, accent, icon, pin, path) rides the sidebar's
  // own folder rows, so this write is a structure change there.
  emitRealtimeSignal('sidebar-structure');
  // `changed: false` is an answer, not a failure: the form re-sent what it
  // already had, or touched a field the store deliberately ignores.
  return json({
    success: true,
    changed: Boolean(updated),
    project: folder ? projectConfigFromFolder(folder) : null,
    accentColorOptions: PROJECT_ACCENT_OPTIONS,
  });
}
