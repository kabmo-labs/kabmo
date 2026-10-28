/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * DELETE /api/worktrees — remove one worktree.
 *
 * Order, and it is the point: stop the live children, archive and delete their
 * sessions, THEN remove the directory. The reverse — which is what a plain
 * `git worktree remove` alone does — leaves a child whose cwd no longer exists,
 * and `resolveSpawnCwd` then quietly runs that session in the server's own
 * directory: a chat the user deleted, alive somewhere else.
 *
 * The dirty refusal happens AFTER the sessions are stopped, so a refusal leaves a
 * worktree the user can still see and retry rather than a half-deleted state.
 */

import { json } from '@/server/lib/remix-compat';
import type { ActionFunctionArgs } from '@/server/lib/remix-compat';
import { methodNotAllowed } from '@/server/lib/route-adapter';
import { getDataDir } from '@/server/lib/lifecycle/paths';
import { getDb } from '@/server/db.server';
import { emitRealtimeSignal } from '@/server/lib/realtime/signals.server';
import { pathHolds } from '@/server/lib/fs/canonical';
import { removeWorktreeRow, worktreeRowFor } from '@/server/lib/db/worktree-registry.server';
import { removeWorktree } from '@/server/lib/fs/worktree/remove';
import { invalidateWorktreeTopology } from '@/server/lib/fs/worktree/topology';
import { resolveProjectRoot } from '@/server/lib/omp/core/worktree';
import { listRpcSessions } from '@/server/lib/omp/rpc/session-registry';
import { removeSession } from '@/server/lib/omp/session/delete-flow.server';
import { isMock, mockRefusal, resolveWorktreeProject, worktreeFailureResponse } from '@/server/routes/worktrees/shared';

interface RemoveBody {
  path?: unknown;
  deleteBranch?: unknown;
}

/**
 * Stop and delete every session whose cwd is inside `worktreePath`.
 *
 * A session this process does not manage has no child to stop — its transcript
 * is removed the same way, and the owning instance learns on its next spawn
 * (`resolveSpawnCwd` finds no directory and the row is already gone).
 */
async function stopSessionsIn(worktreePath: string): Promise<string[]> {
  const handled: string[] = [];
  for (const session of liveSessions()) {
    if (!(await pathHolds(worktreePath, session.cwd))) continue;
    // `removeSession` IS the single-delete sequence: pending-id refusal, id
    // shape, the busy-child 409, `destroyAndWait`, then the purge. Repeating any
    // of it here is how the batch path would drift from `DELETE /api/sessions/:id`.
    const removal = await removeSession(session.id);
    if (removal.ok) handled.push(session.id);
  }
  return handled;
}

/** Live wrappers, as the registry reports them. */
function liveSessions(): { id: string; cwd: string }[] {
  return listRpcSessions().map((session) => ({ id: session.sessionId, cwd: session.cwd }));
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== 'DELETE') return methodNotAllowed({ request, params: {} });
  if (isMock()) return mockRefusal();

  const url = new URL(request.url);
  const resolved = await resolveWorktreeProject(url.searchParams.get('root'), url.searchParams.get('folderId'));
  if (resolved.error) return resolved.error;
  const projectPath = resolved.root as string;

  const body = (await request.json().catch(() => ({}))) as RemoveBody;
  const worktreePath = typeof body.path === 'string' ? body.path.trim() : '';
  if (!worktreePath) {
    return json({ error: 'path is required', code: 'invalid_name', field: 'location' }, { status: 400 });
  }

  const db = await getDb();
  try {
    const primaryRoot = await resolveProjectRoot(projectPath);
    const removed = await removeWorktree(
      {
        worktreePath,
        projectPath,
        deleteBranch: body.deleteBranch === true,
        managedRoot: `${getDataDir()}/worktrees`,
        stopSessions: stopSessionsIn,
      },
      {
        rowFor: (candidate) => worktreeRowFor(db, candidate),
        removeRow: (candidate) => removeWorktreeRow(db, candidate),
      },
    );
    await invalidateWorktreeTopology(primaryRoot);
    emitRealtimeSignal('sidebar-structure');
    emitRealtimeSignal('workspace-dirty');
    return json(removed);
  } catch (error) {
    return worktreeFailureResponse(error);
  }
}