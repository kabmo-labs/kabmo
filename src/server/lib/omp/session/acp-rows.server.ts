/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The sidebar rows for chats that ran on another harness.
 *
 * An ACP agent writes no session file of its own, so omp's JSONL discovery cannot
 * see those chats: before this module they existed in the live registry and in no
 * list at all, and vanished from the sidebar the moment their tab closed.
 *
 * They come from `harness_sessions`, and each one is filed by resolving ITS OWN
 * cwd to a project root — the same resolution the scan applies — so a chat
 * started in a subdirectory lands in the repository that owns it, and a chat
 * whose cwd is outside every registered workspace lands in none rather than
 * inflating the first folder.
 */

import { canonicalPath } from '@/server/lib/fs/canonical';
import { resolveProjectRoot } from '@/server/lib/omp/core/worktree';
import type { HarnessSessionRow } from '@/server/lib/harness/session-store.server';
import { knownHarness } from '@/server/lib/harness/session-store.server';
import { HARNESS_IDS } from '@/shared/lib/harness/catalog';
import { deriveSessionTitle } from '@/shared/lib/omp/session/sidebar';
import type { SessionItemData } from '@/shared/types';

/**
 * The ACP rows that belong to one folder.
 *
 * A chat's folder is decided by ITS OWN cwd resolved to a project root, exactly
 * as omp's discovered sessions are — so a chat started in `packages/app` is filed
 * under the repository that owns it, and a chat whose cwd sits outside every
 * registered workspace is filed under none (rather than inflating the first
 * folder in the list).
 *
 * The resolution is cached per cwd for the duration of one sidebar build: the
 * scan walks the filesystem, and a folder loop re-resolving the same handful of
 * directories once per folder is the kind of cost that only shows up on an
 * install with many workspaces.
 */
export async function acpRowsFor(
  sessions: readonly HarnessSessionRow[],
  folderRootKey: string,
  folderId: number,
  archivedIds: Set<string>,
  resolvedRoots: Map<string, string> = new Map(),
): Promise<SessionItemData[]> {
  const rows: SessionItemData[] = [];
  for (const row of sessions) {
    if (!row.cwd) continue;
    let root = resolvedRoots.get(row.cwd);
    if (root === undefined) {
      root = await resolveProjectRoot(row.cwd).catch(() => '');
      resolvedRoots.set(row.cwd, root);
    }
    if (!root || (await canonicalPath(root)) !== folderRootKey) continue;
    const harness = knownHarness(row.harness, HARNESS_IDS);
    rows.push({
      id: row.sessionId,
      folder_id: folderId,
      // The chat's own name, or its first prompt. An ACP agent publishes no
      // session file for omp's scan to read, so the two facts `sessionTitleFor`
      // reads for an omp row are stored beside the record instead (see
      // `harness/session-title.server.ts`) and the SAME precedence is applied —
      // before it, every recorded chat drew `Untitled` for its whole life.
      title: deriveSessionTitle({ name: row.title, created: row.createdAt }),
      ...(harness ? { harness } : {}),
      created_at: new Date(row.createdAt).toISOString(),
      updated_at: new Date(row.updatedAt).toISOString(),
      is_active: 0,
      is_archived: archivedIds.has(row.sessionId) ? 1 : 0,
      hasSubagents: false,
      cwd: row.cwd,
    });
  }
  return rows;
}

