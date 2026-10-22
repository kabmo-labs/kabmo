import { json } from '@/server/lib/remix-compat';
import type { ActionFunctionArgs, LoaderFunctionArgs } from '@/server/lib/remix-compat';
import { methodNotAllowed } from '@/server/lib/route-adapter';
import { readModelRoles, writeModelRoles } from '@/server/lib/omp/config/roles';
import { readModelRoleCandidates } from '@/server/lib/model-roles/catalog.server';
import {
  deleteModelRolePreset,
  listModelRolePresets,
  saveModelRolePreset,
  seedPresetFromCurrentRoles,
} from '@/server/lib/model-roles/store.server';
import { normalizeRoleMap } from '@/shared/lib/omp/config/model-roles';
import type { ModelRolesPayload } from '@/shared/types/model-roles';

/**
 * Model roles: the live `modelRoles` map from config.yml, the presets Kabmo
 * stores for it, and the catalog the role dropdowns offer.
 *
 * Three verbs, each with one job:
 *   - `GET`    → everything the panel renders (roles, presets, candidates), and
 *                the ONE-SHOT seed that snapshots an install's existing roles
 *                into a preset the first time the panel is opened.
 *   - `PUT`    → replace the whole `modelRoles` map. This is what applying a
 *                preset does, and what the per-row editors do with one entry
 *                changed; there is no per-role verb, because config.yml's map is
 *                written whole either way.
 *   - `POST`   → save a preset (`{ preset: { id?, name, roles } }`).
 *   - `DELETE` → remove a preset by `?id=`.
 */
export async function loader(_args: LoaderFunctionArgs) {
  try {
    // Roles first: the seed snapshots them, and the presets list is read after
    // it so the seeded row is in the very first payload the panel renders.
    const [{ path, roles }, catalog] = await Promise.all([
      readModelRoles(),
      readModelRoleCandidates(),
    ]);
    await seedPresetFromCurrentRoles(roles);
    const presets = await listModelRolePresets();
    const payload: ModelRolesPayload = {
      path,
      roles,
      presets,
      candidates: catalog.candidates,
      candidatesError: catalog.error,
    };
    return json(payload);
  } catch (error) {
    return json({ error: String(error) }, { status: 400 });
  }
}

export async function action({ request, params }: ActionFunctionArgs) {
  try {
    if (request.method === 'PUT') return await saveRoles(request);
    if (request.method === 'POST') return await savePreset(request);
    if (request.method === 'DELETE') return await removePreset(request);
    return methodNotAllowed({ request, params });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}

async function saveRoles(request: Request): Promise<Response> {
  const body = await request.json() as { roles?: unknown };
  const roles = normalizeRoleMap(body.roles);
  await writeModelRoles(roles);
  return json({ success: true, roles });
}

async function savePreset(request: Request): Promise<Response> {
  const body = await request.json() as { preset?: unknown };
  const preset = typeof body.preset === 'object' && body.preset !== null ? body.preset : null;
  if (!preset) return json({ error: 'preset is required' }, { status: 400 });
  const draft = preset as Record<string, unknown>;
  const stored = await saveModelRolePreset({
    id: typeof draft.id === 'string' && draft.id ? draft.id : null,
    name: draft.name,
    roles: draft.roles,
  });
  return json({ success: true, preset: stored, presets: await listModelRolePresets() });
}

async function removePreset(request: Request): Promise<Response> {
  const id = new URL(request.url).searchParams.get('id');
  if (!id) return json({ error: 'id is required' }, { status: 400 });
  const removed = await deleteModelRolePreset(id);
  if (!removed) return json({ error: 'Preset not found' }, { status: 404 });
  return json({ success: true, presets: await listModelRolePresets() });
}
