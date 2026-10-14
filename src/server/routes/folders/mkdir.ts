/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * POST /api/folders/mkdir — create a subdirectory beside the one the New
 * Workspace modal is browsing.
 *
 * Body: { parent: string, name: string }
 *
 * This is NOT `/api/fs/action`'s `create`, and deliberately so. That route
 * resolves its scope through `resolveRoot`, which only accepts the app root,
 * a path beneath it, or a registered `project_path` — and the whole point of
 * this dialog is to name a directory that is NOT registered yet (`~/projects`).
 * A request for one would fall back to the app root and create the folder in
 * the wrong place, so the parent here is validated as an absolute existing
 * directory instead.
 *
 * Two refusals are load-bearing:
 *
 * - **The name must be one path segment.** The parent is what names the
 *   location; a name carrying a separator (or `.`/`..`) would let the client
 *   mkdir anywhere on the filesystem. `isSinglePathSegment` asserts that
 *   `normalize(name) === name`, so the directory built by `join` cannot
 *   resolve outside the parent — the same proof the session purge relies on.
 * - **An existing name is REFUSED, not adopted.** `mkdir` without `recursive`
 *   throws `EEXIST`, and reporting it as an error is the honest answer: the
 *   user asked to create a folder and the folder already exists, so silently
 *   selecting the existing one would hide that the name they typed is taken.
 *
 * The new directory is reported back but NOT selected: the modal's own listing
 * is refreshed and the user picks it, which keeps "make a folder" and "choose
 * this folder" two decisions rather than one.
 */

import { json } from '@/server/lib/remix-compat';
import type { ActionFunctionArgs } from '@/server/lib/remix-compat';
import { methodNotAllowed } from '@/server/lib/route-adapter';
import { join } from 'path';
import fs from 'fs';
import { isSinglePathSegment } from '@/server/lib/fs/path-segment';
import { pathExists } from '@/server/lib/omp/core/paths';
import { expandHome } from '@/server/routes/folders/create';
import { isMockMode } from '@/server/mock.server';

export async function action({ request, params }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return methodNotAllowed({ request, params });
  }

  if (isMockMode()) {
    return json({ error: 'Creating folders is unavailable in mock mode' }, { status: 400 });
  }

  let body: { parent?: unknown; name?: unknown };
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const rawParent = typeof body.parent === 'string' ? body.parent.trim() : '';
  const name = typeof body.name === 'string' ? body.name.trim() : '';

  if (!rawParent) {
    return json({ error: 'A parent directory is required', code: 'parent_required' }, { status: 400 });
  }
  if (!isSinglePathSegment(name)) {
    return json(
      { error: 'Enter a folder name without slashes', code: 'invalid_name' },
      { status: 400 },
    );
  }

  const parent = expandHome(rawParent);
  const parentStat = await Bun.file(parent).stat().catch(() => null);
  if (!parentStat?.isDirectory()) {
    return json({ error: `Not a directory: ${rawParent}`, code: 'parent_not_a_directory' }, { status: 400 });
  }

  const target = join(parent, name);
  if (await pathExists(target)) {
    return json({ error: `${name} already exists`, code: 'exists' }, { status: 409 });
  }

  try {
    // `recursive: false` on purpose: the parent was just verified, so a failure
    // here is a real error (permissions, a race) rather than a missing tree to
    // create, and it must not be swallowed.
    await fs.promises.mkdir(target);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }

  return json({ success: true, path: target, name });
}
