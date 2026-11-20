/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The directories one ACP chat may work in.
 *
 * ACP carries `additionalDirectories` on `session/new|load|resume|fork` when the
 * agent advertises `sessionCapabilities.additionalDirectories`. Kabmo never sent
 * it, so an agent driving a WORKTREE chat could only write inside the worktree
 * — and its `fs/*` calls for the repository the worktree belongs to were refused
 * as "outside this session's workspace".
 *
 * The roots are computed from what Kabmo already knows: the session's cwd, plus
 * the primary repository root when the cwd IS a worktree (the worktree registry
 * holds that pair). Nothing else is invented — a root the client will not serve
 * must not be advertised to the agent either.
 */

import { getDb } from '@/server/db.server';
import { worktreeRowFor } from '@/server/lib/db/worktree-registry.server';

/** The session's own root plus any registered parent repository root. */
export async function sessionRoots(cwd: string): Promise<string[]> {
  const roots = [cwd];
  try {
    const db = await getDb();
    const row = await worktreeRowFor(db, cwd);
    if (row?.primary_root && row.primary_root !== cwd) roots.push(row.primary_root);
  } catch {
    // no-excuse-ok: catch — an unreadable worktree registry leaves one root,
    // which is the same behaviour as before this module existed.
  }
  return roots;
}

/** The `additionalDirectories` list to send, or nothing when the capability is
 *  absent or there is only one root. */
export function additionalDirectoriesFor(
  roots: readonly string[],
  cwd: string,
  advertised: boolean,
): { additionalDirectories?: string[] } {
  const extra = roots.filter((root) => root !== cwd);
  return advertised && extra.length > 0 ? { additionalDirectories: extra } : {};
}
