/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * POST /api/folders — create a workspace folder (user action, real mode).
 *
 * Body: { name?: string, path?: string }
 *
 * A workspace folder is the user's own grouping over an oh-my-pi project. When
 * `path` is provided the folder is bound to that project root (project_path),
 * so its session items are filled from the omp JSONL discovery; the folder
 * name defaults to the lowercase basename of the path. When only `name` is
 * given, an unbound folder is created (no auto sessions).
 *
 * The path must exist and be a directory; no project discovery is implied —
 * the user explicitly chooses what to add.
 *
 * The insert lives in `lib/workspace/register-folder.server.ts`, shared with
 * `POST /api/folders/clone`: both paths owe the same tombstone cleanup, watcher
 * sync and sidebar signal. The directory is validated BEFORE the name
 * collision is checked, so a path that does not exist is reported as such
 * rather than as a duplicate of whatever name it would have derived.
 */

import { json } from '@/server/lib/remix-compat';
import type { ActionFunctionArgs } from '@/server/lib/remix-compat';
import { methodNotAllowed } from '@/server/lib/route-adapter';
import { resolve } from 'path';
import { homedir } from 'os';
import { getDb } from '@/server/db.server';
import { defaultFolderName, registerWorkspaceFolder } from '@/server/lib/workspace/register-folder.server';

/** `~` and `~/x` expanded against the OS home, then made absolute. */
export function expandHome(value: string): string {
  if (value === '~') return homedir();
  if (value.startsWith('~/')) return resolve(homedir(), value.slice(2));
  return resolve(value);
}

export async function action({ request, params }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return methodNotAllowed({ request, params });
  }

  let body: { name?: unknown; path?: unknown };
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const rawName = typeof body.name === 'string' ? body.name.trim() : '';
  const rawPath = typeof body.path === 'string' ? body.path.trim() : '';

  let name = rawName;
  let projectPath: string | null = null;

  if (rawPath) {
    const candidate = expandHome(rawPath);
    try {
      if (!(await Bun.file(candidate).stat()).isDirectory()) {
        return json({ error: `Not a directory: ${rawPath}`, code: 'not_a_directory' }, { status: 400 });
      }
    } catch {
      return json({ error: `Directory does not exist: ${rawPath}`, code: 'directory_not_found' }, { status: 400 });
    }
    projectPath = candidate;
    if (!name) name = defaultFolderName(candidate);
  }

  if (!name) {
    return json({ error: 'Workspace name is required', code: 'name_required' }, { status: 400 });
  }

  const db = await getDb();
  const result = await registerWorkspaceFolder(db, { name, projectPath });
  if (!result.ok) {
    return json({ error: result.error, code: result.code }, { status: 400 });
  }

  return json({ success: true, folder: { id: result.id, name: result.name, project_path: projectPath } });
}
