/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * POST /api/worktrees — create a worktree, and POST /api/worktrees/validate —
 * the same plan without touching disk.
 *
 * Both go through `planWorktree`, so the dialog cannot be told "fine" by a check
 * that the create then contradicts: every refusal a create can raise is raised
 * by the validate call first, with the same code and the same field.
 *
 * The body carries the DIALOG's state, never a resolved path: a client that
 * could name the directory could name one outside the project.
 */

import { json } from '@/server/lib/remix-compat';
import type { ActionFunctionArgs } from '@/server/lib/remix-compat';
import { methodNotAllowed } from '@/server/lib/route-adapter';
import { getDb } from '@/server/db.server';
import { emitRealtimeSignal } from '@/server/lib/realtime/signals.server';
import { getDataDir } from '@/server/lib/lifecycle/paths';
import { putWorktreeRow, worktreeIdentityFor } from '@/server/lib/db/worktree-registry.server';
import { asWorktreeFailure } from '@/server/lib/fs/worktree/errors';
import { createWorktree, planWorktree } from '@/server/lib/fs/worktree/create';
import { invalidateWorktreeTopology } from '@/server/lib/fs/worktree/topology';
import { readWorktreeSettings } from '@/server/lib/fs/worktree/settings.server';
import type { WorktreeValidation } from '@/shared/lib/workspace/worktree/types';
import { isMock, mockRefusal, resolveWorktreeProject, worktreeFailureResponse } from '@/server/routes/worktrees/shared';

interface CreateBody {
  mode?: unknown;
  branch?: unknown;
  worktreeName?: unknown;
  startRef?: unknown;
  carryIgnored?: unknown;
}

function readBody(body: CreateBody) {
  return {
    mode: body.mode === 'existing' ? ('existing' as const) : ('new' as const),
    branch: typeof body.branch === 'string' ? body.branch : '',
    worktreeName: typeof body.worktreeName === 'string' ? body.worktreeName : '',
    startRef: typeof body.startRef === 'string' ? body.startRef : undefined,
    carryIgnored: typeof body.carryIgnored === 'boolean' ? body.carryIgnored : undefined,
  };
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== 'POST') return methodNotAllowed({ request, params: {} });
  if (isMock()) return mockRefusal();

  const url = new URL(request.url);
  const resolved = await resolveWorktreeProject(url.searchParams.get('root'), url.searchParams.get('folderId'));
  if (resolved.error) return resolved.error;
  const projectPath = resolved.root as string;

  const body = (await request.json().catch(() => ({}))) as CreateBody;
  const parsed = readBody(body);
  const settings = await readWorktreeSettings();
  const db = await getDb();
  const deps = {
    identityFor: (candidate: string) => worktreeIdentityFor(db, candidate),
    carryIgnored: settings.carryIgnored,
    dataDir: getDataDir(),
    configuredDirectory: settings.directory,
    record: async (row: {
      path: string;
      primaryRoot: string;
      projectId: string;
      branch: string;
      startRef: string;
      createdAt: string;
    }) => {
      await putWorktreeRow(db, {
        path: row.path,
        primary_root: row.primaryRoot,
        project_id: row.projectId,
        branch: row.branch,
        start_ref: row.startRef,
        created_at: row.createdAt,
      });
    },
  };

  try {
    const created = await createWorktree({ projectPath, ...parsed }, deps);
    await invalidateWorktreeTopology(created.primaryRoot);
    // The new folder is structure: every sidebar re-reads, and the panels that
    // already point at this repository drop their cached topology.
    emitRealtimeSignal('sidebar-structure');
    emitRealtimeSignal('workspace-dirty');
    return json({ worktree: created, carried: created.carried });
  } catch (error) {
    return worktreeFailureResponse(error);
  }
}

/**
 * The same plan, without creating anything. Answers every failure rather than
 * the first, because a dialog that shows one error at a time makes the user
 * discover the second one after fixing the first.
 */
export async function validateAction({ request }: ActionFunctionArgs) {
  if (request.method !== 'POST') return methodNotAllowed({ request, params: {} });
  if (isMock()) return mockRefusal();

  const url = new URL(request.url);
  const resolved = await resolveWorktreeProject(url.searchParams.get('root'), url.searchParams.get('folderId'));
  if (resolved.error) return resolved.error;
  const projectPath = resolved.root as string;

  const body = (await request.json().catch(() => ({}))) as CreateBody;
  const parsed = readBody(body);
  const settings = await readWorktreeSettings();
  const db = await getDb();

  try {
    const plan = await planWorktree(
      { projectPath, ...parsed },
      {
        identityFor: (candidate: string) => worktreeIdentityFor(db, candidate),
        dataDir: getDataDir(),
        configuredDirectory: settings.directory,
      },
    );
    const payload: WorktreeValidation = {
      ok: true,
      failures: [],
      resolved: { name: plan.name, directory: plan.directory, branch: plan.branch },
    };
    return json(payload);
  } catch (error) {
    const payload: WorktreeValidation = { ok: false, failures: [asWorktreeFailure(error)] };
    return json(payload, { status: 400 });
  }
}