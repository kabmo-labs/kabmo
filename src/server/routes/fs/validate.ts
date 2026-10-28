/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Real workspace path validation — adapted from omp-web/app/api/cwd/validate/
 * route.ts. Checks existence, directory-ness, and git-repo-ness. Additive
 * endpoint for programmatic use; the locked settings UI does not consume it yet.
 */

import { json } from '@/server/lib/remix-compat';
import { childEnv } from '@/server/lib/fs/child-env';
import type { ActionFunctionArgs } from '@/server/lib/remix-compat';
import { methodNotAllowed } from '@/server/lib/route-adapter';
import { join, resolve } from 'path';
import { pathExists } from '@/server/lib/omp/core/paths';

async function hasGitCommand(): Promise<boolean> {
  try {
    return (await Bun.spawn(['git', '--version'], { env: childEnv() }).exited) === 0;
  } catch {
    // Bun.spawn throws ENOENT when the binary is missing from PATH.
    return false;
  }
}

async function isInsideGitWorkTree(target: string): Promise<boolean> {
  try {
    return (await Bun.spawn(['git', '-C', target, 'rev-parse', '--is-inside-work-tree'], { env: childEnv() }).exited) === 0;
  } catch {
    return false;
  }
}

export async function action({ request, params }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return methodNotAllowed({ request, params });
  }
  try {
    const body = await request.json();
    if (typeof body.path !== 'string' || body.path.trim() === '') {
      return json({ error: 'path is required' }, { status: 400 });
    }
    const target = resolve(body.path);
    const file = Bun.file(target);
    const exists = await file.exists();
    const isDirectory = exists ? (await file.stat()).isDirectory() : false;
    const gitInstalled = await hasGitCommand();
    const gitRepo = isDirectory && gitInstalled ? await isInsideGitWorkTree(target) : await pathExists(join(target, '.git'));

    return json({
      valid: isDirectory,
      exists,
      isDirectory,
      isGitRepo: gitRepo,
      path: target,
    });
  } catch (error: any) {
    return json({ error: error.message }, { status: 500 });
  }
}
