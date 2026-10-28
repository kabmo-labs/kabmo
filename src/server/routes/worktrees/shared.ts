/**
 * @license
 * SPDX-License-Identifier: MIT
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
import type { WorktreeFailure } from '@/shared/lib/workspace/worktree/types';

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

/**
 * A refusal's HTTP status, from what the refusal MEANS.
 *
 * `dirty` is a conflict with the tree's current state rather than a malformed
 * request — the same distinction `session_not_running` and `mock_mode` draw with
 * 409 — and a caller that retries after committing needs to tell the two apart
 * without parsing the message.
 */
const REFUSAL_STATUS: Partial<Record<WorktreeFailure['code'], number>> = {
  dirty: 409,
};

export function worktreeFailureResponse(error: unknown, status = 400): Response {
  const failure = asWorktreeFailure(error);
  return json({ error: failure.message, ...failure }, { status: REFUSAL_STATUS[failure.code] ?? status });
}

export function isMock(): boolean {
  return isMockMode();
}