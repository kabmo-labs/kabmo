/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The discovery scope a skills/commands read is answered for.
 *
 * omp resolves project-scope skills and commands from the process cwd: a child
 * started in a workspace reports that workspace's `.omp/skills`,
 * `.omp/commands`, `.claude/commands`, `.agents/*` and `.github/*` entries,
 * while a child started elsewhere reports only the user-level ones. So the
 * scope is never a filter applied after the fact — it is which directory omp
 * is asked about, and which roots a write may land in.
 *
 * Verified against omp 18.4.0:
 * - `omp skill list <repo>` reports `native:project` entries (`pr-review`,
 *   `issue-intake` in this repository) that `omp skill list ~/.omp/agent` does
 *   not, and both report the `native:user`/`agents:user` ones.
 * - `get_available_commands` in a workspace reports its `.omp/commands` files
 *   (`projprobe`) plus the user-level ones (`userprobe`, `~/.claude/commands`),
 *   while a child in `~/.omp/agent` reports only the latter — and a child in
 *   `$HOME` reports neither the workspace's nor `~/.omp/agent/commands`, which
 *   is why the USER scope has a cwd of its own instead of "no cwd".
 * - A duplicate name in both roots resolves to the PROJECT file (measured:
 *   `dupe.md` in `~/.omp/agent/commands` and the workspace ran the project
 *   body), which is why a managed-file lookup checks the workspace first.
 *
 * `resolveRoot` gates a client-supplied path (the app root, a path beneath it,
 * or an exact registered `project_path`). The user scope bypasses it because
 * its cwd is server-derived, never client-supplied, and an unresolvable root
 * falls back to the user scope rather than answering with a directory the
 * caller never asked about.
 */

import { getAgentDir } from '@/server/lib/omp/core/paths';
import { resolveRoot } from '@/server/lib/fs/root';

export interface DiscoveryScope {
  /** Workspace root a write/delete may target, or null for the user scope. */
  workspace: string | null;
  /** The cwd omp is asked about: the workspace, the agent dir (user scope),
   *  or the app root for an unscoped read. */
  cwd: string;
}

/**
 * Resolve the `?root=` / `?scope=` a skills/commands request carries.
 *
 * - `scope=user` → the user scope: the agent dir as cwd, no workspace.
 * - `root=<path>` → that workspace (gated by `resolveRoot`).
 * - neither → the app root, which is what an unscoped request has always meant
 *   (the composer's fallback for a session with no workspace folder, where omp
 *   itself spawns in the server's cwd). It stays a workspace because the app
 *   root is a registered root Kabmo may write in.
 */
export async function resolveDiscoveryScope(
  rawRoot: string | null | undefined,
  rawScope?: string | null,
): Promise<DiscoveryScope> {
  if (rawScope === 'user') return { workspace: null, cwd: getAgentDir() };
  if (!rawRoot || !rawRoot.trim()) return { workspace: process.cwd(), cwd: process.cwd() };
  const resolved = await resolveRoot(rawRoot, '');
  return resolved ? { workspace: resolved, cwd: resolved } : { workspace: null, cwd: getAgentDir() };
}
