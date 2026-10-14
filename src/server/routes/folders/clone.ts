/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * POST /api/folders/clone — clone a git repository and register it as a
 * workspace in one step.
 *
 * Body: { url: string, parent: string, name?: string }
 *
 * The clone lands at `<parent>/<slug>` where the slug is what `git clone`
 * itself would name the directory, and the workspace row is written from that
 * SAME resolved path — so the folder the sidebar lists and the directory on
 * disk cannot disagree, which is the one failure this route exists to prevent
 * (a name derived from the URL after the clone picked its own destination is
 * exactly how they drift).
 *
 * Ordering is deliberate:
 *
 * 1. **The URL is validated and the destination is resolved before anything is
 *    cloned.** An invalid source or a name collision costs no network traffic.
 * 2. **A failed clone removes what it created.** `git clone` leaves a partial
 *    directory behind on failure; registering nothing while leaving that
 *    directory in the user's `~/projects` is the worst outcome, so the target
 *    is removed on every failure path.
 * 3. **The workspace is registered only after the clone exits 0.** A folder
 *    row pointing at a half-cloned tree would show sessions for a repository
 *    that is not there.
 *
 * `git` is spawned as argv (never a shell string) with `GIT_TERMINAL_PROMPT=0`
 * — a private repository would otherwise block on a credential prompt with no
 * terminal to answer it, and the URL is user input that must never reach a
 * shell.
 */

import { json } from '@/server/lib/remix-compat';
import type { ActionFunctionArgs } from '@/server/lib/remix-compat';
import { methodNotAllowed } from '@/server/lib/route-adapter';
import { join } from 'path';
import fs from 'fs';
import { getDb } from '@/server/db.server';
import { pathExists } from '@/server/lib/omp/core/paths';
import { runGit } from '@/server/lib/fs/git-run';
import { expandHome } from '@/server/routes/folders/create';
import { defaultFolderName, registerWorkspaceFolder } from '@/server/lib/workspace/register-folder.server';
import { isGitUrl, repoSlug } from '@/shared/lib/git/url';
import { isMockMode } from '@/server/mock.server';

const CLONE_TIMEOUT_MS = 180_000;

export async function action({ request, params }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return methodNotAllowed({ request, params });
  }

  if (isMockMode()) {
    return json({ error: 'Cloning repositories is unavailable in mock mode' }, { status: 400 });
  }

  let body: { url?: unknown; parent?: unknown; name?: unknown };
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const url = typeof body.url === 'string' ? body.url.trim() : '';
  const rawParent = typeof body.parent === 'string' ? body.parent.trim() : '';
  const rawName = typeof body.name === 'string' ? body.name.trim() : '';

  if (!isGitUrl(url)) {
    return json(
      { error: 'Expected an https, ssh, git@ or local path', code: 'invalid_url' },
      { status: 400 },
    );
  }
  if (!rawParent) {
    return json({ error: 'A parent directory is required', code: 'parent_required' }, { status: 400 });
  }

  const slug = repoSlug(url);
  if (!slug) {
    return json({ error: 'That URL names no repository', code: 'invalid_url' }, { status: 400 });
  }

  const parent = expandHome(rawParent);
  const parentStat = await Bun.file(parent).stat().catch(() => null);
  if (!parentStat?.isDirectory()) {
    return json({ error: `Not a directory: ${rawParent}`, code: 'parent_not_a_directory' }, { status: 400 });
  }

  const target = join(parent, slug);
  if (await pathExists(target)) {
    return json({ error: `${slug} already exists in that folder`, code: 'exists' }, { status: 409 });
  }

  // Name collisions are checked BEFORE the clone: a rejected workspace that
  // already cost a full download is the kind of failure a user cannot undo
  // without deleting the directory by hand.
  const db = await getDb();
  const name = rawName || defaultFolderName(target);
  const dup = await db.get('SELECT id FROM workspace_folders WHERE lower(name) = lower(?)', [name]);
  if (dup) {
    return json(
      { error: 'A workspace with this name already exists', code: 'duplicate_name' },
      { status: 400 },
    );
  }

  const clone = await runGit(['clone', '--quiet', url, target], { cwd: parent, timeout: CLONE_TIMEOUT_MS });
  if (clone.error || clone.exitCode !== 0) {
    // `git clone` creates the destination before it knows the fetch will work,
    // so a failure leaves a partial tree. Removed on every failure path.
    await fs.promises.rm(target, { recursive: true, force: true }).catch(() => {});
    const reason = clone.stderr.trim().split('\n')[0]?.trim() || clone.error?.message || 'git clone failed';
    return json({ error: reason, code: 'clone_failed' }, { status: 400 });
  }

  const result = await registerWorkspaceFolder(db, { name, projectPath: target });
  if (!result.ok) {
    // The clone succeeded, so the directory is left in place — it is a real
    // repository the user can add by hand. Only the row is refused.
    return json({ error: result.error, code: result.code }, { status: 400 });
  }

  return json({
    success: true,
    folder: { id: result.id, name: result.name, project_path: target },
    path: target,
  });
}
