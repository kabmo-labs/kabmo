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

import path from 'node:path';
import { json } from '@/server/lib/remix-compat';
import type { LoaderFunctionArgs } from '@/server/lib/remix-compat';
import { getDataDir } from '@/server/lib/lifecycle/paths';
import { resolveProjectRoot } from '@/server/lib/omp/core/worktree';
import { listSessionFiles } from '@/server/lib/omp/session/files';
import { scanSessionInfoCached } from '@/server/lib/omp/session/files';
import { canonicalPath } from '@/server/lib/fs/canonical';
import { worktreeIdentityFor, listWorktreeRows } from '@/server/lib/db/worktree-registry.server';
import { dirtyCount, commitsAheadOf } from '@/server/lib/fs/worktree/remove';
import { listWorktrees, isWorkTree } from '@/server/lib/fs/worktree/list';
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
    // "This folder is not a Git repository" is an ANSWER, not a failure. The
    // payload has carried `isRepo` for exactly this, and a plain directory (a
    // notes folder bound as a workspace) must read as "no worktrees here" —
    // a 500 would make the composer report a broken feature for a folder that
    // simply has nothing to offer. The probe runs before the identity read,
    // which is what throws for a directory with no root commit.
    if (!(await isWorkTree(primaryRoot))) {
      const empty: WorktreeListPayload = { worktrees: [], base: '', isRepo: false };
      return json(empty);
    }
    const settings = await readWorktreeSettings();
    const projectId = await resolveProjectId(primaryRoot, (candidate) => worktreeIdentityFor(db, candidate));
    const base = resolveConfiguredWorktreeRoot(settings.directory, primaryRoot)
      ?? defaultWorktreeRoot(getDataDir(), projectId);

    const entries = await listWorktrees(primaryRoot);
    const [rows, sessionCwds] = await Promise.all([
      listWorktreeRows(db, primaryRoot),
      // Every tree that can be counted, not just the repository: a worktree does
      // NOT have to live inside it. Kabmo's own default puts one under the data
      // directory (`<data>/worktrees/<projectId>/<name>`), so a `primaryRoot`
      // prefix test counted ZERO sessions for every worktree at the default
      // location — the number the delete dialog warns with.
      sessionCwdsUnder([primaryRoot, ...entries.map((entry) => entry.path)]),
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
        sessions: sessionCwds.filter((cwd) => cwd === entry.path || cwd.startsWith(`${entry.path}${path.sep}`)).length,
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

/**
 * Every session's recorded cwd, canonicalized, restricted to the trees that can
 * be counted — the primary checkout and each worktree.
 *
 * Both sides are canonicalized, for the same reason `canonicalPath` exists: the
 * recorded cwd is the spelling the agent was spawned with while a worktree path
 * comes back realpath'd from git, and on macOS those differ for anything under
 * `/var` (a symlink to `/private/var`) — a raw prefix test would then count zero
 * for a worktree that is right there.
 */
async function sessionCwdsUnder(roots: string[]): Promise<string[]> {
  const files = await listSessionFiles();
  const infos = await Promise.all(files.map((file) => scanSessionInfoCached(file)));
  const canonicalRoots = [...new Set(await Promise.all(roots.map((root) => canonicalPath(root))))];
  const cwds: string[] = [];
  const seen = new Set<string>();
  for (const info of infos) {
    if (!info?.cwd || seen.has(info.cwd)) continue;
    seen.add(info.cwd);
    const cwd = await canonicalPath(info.cwd);
    if (!canonicalRoots.some((root) => cwd === root || cwd.startsWith(`${root}${path.sep}`))) continue;
    cwds.push(cwd);
  }
  return cwds;
}