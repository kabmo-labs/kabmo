/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The worktree routes' shared plumbing: resolve the project, refuse in MOCK, and
 * turn a `WorktreeError` into the JSON envelope the client already understands.
 *
 * Root resolution goes through `resolveRoot`, the security boundary every fs
 * route uses — a client-supplied `root` is only honoured when it is the app
 * root, a registered `project_path`, or (this feature) a worktree of one.
 */

import { json } from '@/server/lib/remix-compat';
import { isMockMode } from '@/server/mock.server';
import { getDb } from '@/server/db.server';
import { resolveRoot } from '@/server/lib/fs/root';
import { asWorktreeFailure } from '@/server/lib/fs/worktree/errors';

/** A registered workspace's `project_path`, or null when the folder is unbound. */
export async function projectPathForFolder(folderId: number | string | null): Promise<string | null> {
  if (folderId === null || folderId === '') return null;
  try {
    const db = await getDb();
    const row = await db.get<{ project_path: string | null }>(
      'SELECT project_path FROM workspace_folders WHERE id = ?',
      [Number(folderId)],
    );
    return row?.project_path ?? null;
  } catch {
    return null;
  }
}

/** The project a request names: its own `root`, else the folder's binding. */
export async function resolveWorktreeProject(
  rawRoot: string | null | undefined,
  folderId: string | null,
): Promise<{ root: string | null; error?: Response }> {
  const fromFolder = await projectPathForFolder(folderId);
  const root = await resolveRoot(rawRoot || fromFolder, '');
  if (!root) {
    return {
      root: null,
      error: json(
        {
          error: 'Pick a workspace bound to a Git repository first.',
          code: 'not_a_repo',
        },
        { status: 400 },
      ),
    };
  }
  return { root };
}

/**
 * A worktree mutation in demo mode is refused rather than simulated: MOCK has no
 * repository on disk, so a "successful" create would promise a folder that does
 * not exist.
 */
export function mockRefusal(): Response {
  return json(
    { error: 'Worktrees need a real Git repository; Kabmo is running in demo mode.', code: 'mock_mode' },
    { status: 409 },
  );
}

export function worktreeFailureResponse(error: unknown, status = 400): Response {
  const failure = asWorktreeFailure(error);
  return json({ error: failure.message, ...failure }, { status });
}

export function isMock(): boolean {
  return isMockMode();
}