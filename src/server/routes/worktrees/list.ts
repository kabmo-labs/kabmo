/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * GET /api/worktrees — the worktrees of one project, with the facts a row shows.
 *
 * Deliberately NOT on the realtime `git:` topic: that payload is republished on
 * every tool call, and this read costs a `git status` per worktree. It is opened
 * by hand (Settings → Projects → Worktrees, and the delete dialog), exactly the
 * reasoning `git-repo-details.ts` records for keeping the repo modal off it.
 *
 * `sessions` counts chats whose cwd is inside a worktree, from the same topology
 * the sidebar uses — so the number a row shows is the number of rows the user
 * can see under it.
 */

import { json } from '@/server/lib/remix-compat';
import type { LoaderFunctionArgs } from '@/server/lib/remix-compat';
import { getDataDir } from '@/server/lib/lifecycle/paths';
import { resolveProjectRoot } from '@/server/lib/omp/core/worktree';
import { listSessionFiles } from '@/server/lib/omp/session/files';
import { scanSessionInfoCached } from '@/server/lib/omp/session/files';
import { canonicalPath } from '@/server/lib/fs/canonical';
import { worktreeIdentityFor, listWorktreeRows } from '@/server/lib/db/worktree-registry.server';
import { dirtyCount, commitsAheadOf } from '@/server/lib/fs/worktree/remove';
import { listWorktrees } from '@/server/lib/fs/worktree/list';
import {
  defaultWorktreeRoot,
  resolveConfiguredWorktreeRoot,
} from '@/server/lib/fs/worktree/location';
import { readWorktreeSettings } from '@/server/lib/fs/worktree/settings.server';
import { resolveProjectId } from '@/server/lib/fs/worktree/project-id';
import { getDb } from '@/server/db.server';
import { isMock } from '@/server/routes/worktrees/shared';
import { mockRefusal, resolveWorktreeProject, worktreeFailureResponse } from '@/server/routes/worktrees/shared';
import type { WorktreeInfo, WorktreeListPayload } from '@/shared/lib/workspace/worktree/types';

export async function loader({ request }: LoaderFunctionArgs) {
  if (isMock()) return mockRefusal();

  const url = new URL(request.url);
  const resolved = await resolveWorktreeProject(url.searchParams.get('root'), url.searchParams.get('folderId'));
  if (resolved.error) return resolved.error;
  const root = resolved.root as string;

  try {
    const db = await getDb();
    const primaryRoot = await resolveProjectRoot(root);
    const settings = await readWorktreeSettings();
    const projectId = await resolveProjectId(primaryRoot, (candidate) => worktreeIdentityFor(db, candidate));
    const base = resolveConfiguredWorktreeRoot(settings.directory, primaryRoot)
      ?? defaultWorktreeRoot(getDataDir(), projectId);

    const [entries, rows, sessionCwds] = await Promise.all([
      listWorktrees(primaryRoot),
      listWorktreeRows(db, primaryRoot),
      sessionCwdsUnder(primaryRoot),
    ]);
    const rowByPath = new Map(rows.map((row) => [row.path, row]));

    const worktrees: WorktreeInfo[] = [];
    for (const entry of entries) {
      const row = rowByPath.get(entry.path);
      const dirty = entry.isPrimary ? 0 : await dirtyCount(entry.path).catch(() => 0);
      const ahead = entry.isPrimary
        ? 0
        : (await commitsAheadOf(primaryRoot, row?.start_ref ?? '', entry.branch)) ?? 0;
      worktrees.push({
        path: entry.path,
        branch: entry.branch,
        head: entry.head,
        detached: entry.detached,
        missing: entry.missing,
        isPrimary: entry.isPrimary,
        dirty,
        aheadOfStart: ahead,
        startRef: row?.start_ref ?? '',
        sessions: sessionCwds.filter((cwd) => cwd === entry.path || cwd.startsWith(`${entry.path}/`)).length,
      });
    }

    const payload: WorktreeListPayload = { worktrees, base, isRepo: true };
    return json(payload);
  } catch (error) {
    // A failed listing is REPORTED, never substituted with an empty list: "no
    // worktrees" and "git could not answer" are different answers, and only one
    // of them means the user has nothing there.
    return worktreeFailureResponse(error, 500);
  }
}

/** Every session's recorded cwd, canonicalized, for the per-worktree count. */
async function sessionCwdsUnder(primaryRoot: string): Promise<string[]> {
  const files = await listSessionFiles();
  const infos = await Promise.all(files.map((file) => scanSessionInfoCached(file)));
  const cwds: string[] = [];
  for (const info of infos) {
    if (!info?.cwd) continue;
    if (!info.cwd.startsWith(primaryRoot)) continue;
    cwds.push(await canonicalPath(info.cwd));
  }
  return cwds;
}