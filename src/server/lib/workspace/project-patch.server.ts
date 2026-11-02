/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Turn a settings PATCH body for one workspace into a row patch the store can
 * apply, or a refusal that names what is wrong.
 *
 * The pane edits facts that decide where chats run and which sessions appear in
 * the sidebar, so a value that cannot be honoured must be refused HERE rather
 * than written and quietly ignored:
 *
 * - **A project needs a name.** The store skips an empty name on purpose (so a
 *   partial update cannot blank a row), which meant the field could be cleared
 *   on screen while the old name stayed on the server — a rename that silently
 *   did nothing.
 * - **Names are unique case-insensitively**, the same rule the creation path
 *   enforces (`registerWorkspaceFolder`), because the sidebar identifies a
 *   workspace by its name.
 * - **A project path must be a real directory**, expanded from `~` exactly like
 *   the creation path. Binding a typo produced a folder that listed no sessions
 *   forever with nothing on screen saying why.
 * - **An accent must be a hex colour.** The sidebar paints it into a CSS
 *   `color`, so a free-form string is a style injection, not a preference.
 * - **One directory, one workspace.** Two rows bound to the same root list the
 *   same sessions twice and fight over the discovery tombstones.
 */

import { getDb } from '@/server/db.server';
import type { DbClient } from '@/server/lib/db/client';
import { projectPathKey } from '@/server/lib/omp/core/paths';
import { expandHome } from '@/server/routes/folders/create';
import { normalizeHexAccent } from '@/shared/lib/workspace/project-accent';
import { parseFolderSettingsPatch, type FolderSettingsPatch } from '@/shared/lib/workspace/project-settings';

export type PreparedProjectPatch =
  | { ok: true; patch: FolderSettingsPatch }
  | { ok: false; status: number; error: string; code?: string };

/** An icon may be an uploaded raster (data URL) or a fetched absolute URL. */
const MAX_ICON_CHARS = 700_000; // ~512 KiB of bytes, base64-inflated

/**
 * True when the value is something an `<img src>` can render and the store may
 * keep. The field is written from the client, and without this a whole
 * megabyte image, a `javascript:` URI or a relative path could be persisted as
 * a project icon and then rendered in every sidebar row.
 */
function isIconUrl(value: string): boolean {
  if (value.length > MAX_ICON_CHARS) return false;
  if (/^data:image\/(png|jpeg|jpg|svg\+xml|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(value)) return true;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

/** True when the path is an existing directory (symlinks followed). */
async function isDirectory(target: string): Promise<boolean> {
  try {
    return (await Bun.file(target).stat()).isDirectory();
  } catch {
    return false;
  }
}

export async function prepareProjectPatch(
  db: DbClient,
  folderId: string,
  raw: unknown,
): Promise<PreparedProjectPatch> {
  const patch = parseFolderSettingsPatch(raw);

  if (patch.name !== undefined && patch.name === '') {
    return { ok: false, status: 400, error: 'A project needs a name', code: 'name_required' };
  }

  if (patch.name !== undefined) {
    const clash = await db.get<{ id: number }>(
      'SELECT id FROM workspace_folders WHERE lower(name) = lower(?) AND id != ?',
      [patch.name, folderId],
    );
    if (clash) {
      return {
        ok: false,
        status: 409,
        error: `A workspace named "${patch.name}" already exists`,
        code: 'duplicate_name',
      };
    }
  }

  if (patch.accentColor !== undefined && patch.accentColor !== '') {
    const normalized = normalizeHexAccent(patch.accentColor);
    if (normalized === null) {
      return {
        ok: false,
        status: 400,
        error: 'An accent must be a hex colour like #7c3aed',
        code: 'invalid_accent',
      };
    }
    // Stored in ONE form — the sidebar paints this straight into a style, and two
    // spellings of the same colour would defeat the "is this a preset?" check.
    patch.accentColor = normalized;
  }

  if (patch.customIconUrl !== undefined && patch.customIconUrl !== null && !isIconUrl(patch.customIconUrl)) {
    return {
      ok: false,
      status: 400,
      error: 'An icon must be an uploaded image or an http(s) URL under 512 KiB',
      code: 'invalid_icon',
    };
  }

  if (patch.projectPath) {
    const resolved = expandHome(patch.projectPath);
    if (!(await isDirectory(resolved))) {
      return {
        ok: false,
        status: 400,
        error: `Directory does not exist: ${patch.projectPath}`,
        code: 'directory_not_found',
      };
    }
    const target = projectPathKey(resolved);
    const bound = await db.all<{ id: number; project_path: string | null }>(
      'SELECT id, project_path FROM workspace_folders WHERE project_path IS NOT NULL AND id != ?',
      [folderId],
    );
    const duplicate = bound.find((row) => row.project_path && projectPathKey(row.project_path) === target);
    if (duplicate) {
      // A worktree of a bound project canonicalizes elsewhere, so this only
      // refuses the same project root twice.
      const other = await db.get<{ name: string }>('SELECT name FROM workspace_folders WHERE id = ?', [duplicate.id]);
      return {
        ok: false,
        status: 409,
        error: `${other?.name ?? 'Another workspace'} is already bound to ${resolved}`,
        code: 'duplicate_path',
      };
    }
    patch.projectPath = resolved;
  }

  return { ok: true, patch };
}

/** Convenience for route handlers: prepare against the process database. */
export async function prepareProjectPatchForStore(folderId: string, raw: unknown): Promise<PreparedProjectPatch> {
  return prepareProjectPatch(await getDb(), folderId, raw);
}
