/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Worktree topology of one repository, and the session → worktree lookup built
 * on it.
 *
 * A session's badge is derived from its own cwd, never from a stored
 * association: the cwd is the truth and it survives a branch rename.
 *
 * The topology is cached per primary root for a short TTL, because the sidebar
 * scan runs on every publish while `git worktree list` costs a spawn per
 * repository. `invalidateWorktreeTopology()` is called by the create and remove
 * paths, and by the `workspace-dirty` signal, so a worktree made a second ago
 * appears without waiting the TTL out.
 */

import { canonicalPath, pathHolds } from '@/server/lib/fs/canonical';
import { listWorktrees, type WorktreeEntry } from '@/server/lib/fs/worktree/list';
import type { SessionWorktreeInfo } from '@/shared/lib/workspace/worktree/types';

const TOPOLOGY_TTL_MS = 10_000;

declare global {
  // eslint-disable-next-line no-var
  var __kabmoWorktreeTopology:
    | Map<string, { entries: WorktreeEntry[]; expiresAt: number; inFlight?: Promise<WorktreeEntry[]> }>
    | undefined;
}

function topologyCache(): Map<string, { entries: WorktreeEntry[]; expiresAt: number; inFlight?: Promise<WorktreeEntry[]> }> {
  globalThis.__kabmoWorktreeTopology ??= new Map();
  return globalThis.__kabmoWorktreeTopology;
}

/** Drop the cache for one repository, or all of them. */
export async function invalidateWorktreeTopology(primaryRoot?: string): Promise<void> {
  const cache = topologyCache();
  if (!primaryRoot) {
    cache.clear();
    return;
  }
  cache.delete(await canonicalPath(primaryRoot));
}

/**
 * Every worktree of `primaryRoot`, cached for a few seconds. A failure is NOT
 * cached: an unreadable repository must not look like one with no worktrees for
 * the next ten minutes.
 */
export async function readProjectWorktrees(primaryRoot: string): Promise<WorktreeEntry[]> {
  const cache = topologyCache();
  // Keyed by the CANONICAL root: a caller holding `/tmp/x` and one holding
  // `/private/tmp/x` are asking about one repository, and two entries would let
  // an invalidation miss the entry a later read created (measured: the
  // invalidation dropped nothing and the new worktree stayed invisible).
  const key = await canonicalPath(primaryRoot);
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.entries;
  if (hit?.inFlight) return hit.inFlight;

  const inFlight = listWorktrees(key)
    .then((entries) => {
      cache.set(key, { entries, expiresAt: Date.now() + TOPOLOGY_TTL_MS });
      return entries;
    })
    .catch((error: unknown) => {
      cache.delete(key);
      throw error;
    });

  cache.set(key, { entries: hit?.entries ?? [], expiresAt: 0, inFlight });
  return inFlight;
}

/**
 * The worktree holding `cwd`, or null when the session runs in the checkout
 * itself — a chat in the main repository is not a "worktree session", and a
 * badge on every row would be noise — or in none.
 *
 * Longest path wins, so a worktree nested inside another resolves to the inner
 * checkout: the directory the agent actually writes to.
 */
export async function worktreeForCwd(
  entries: WorktreeEntry[],
  cwd: string,
  primaryRoot: string,
): Promise<SessionWorktreeInfo | null> {
  let best: WorktreeEntry | null = null;
  let bestLength = -1;

  for (const entry of entries) {
    if (!entry.path || entry.isPrimary) continue;
    if (!(await pathHolds(entry.path, cwd))) continue;
    const length = (await canonicalPath(entry.path)).length;
    if (length <= bestLength) continue;
    best = entry;
    bestLength = length;
  }

  if (!best) return null;
  return {
    branch: best.branch,
    path: await canonicalPath(best.path),
    primaryRoot,
    status: best.missing ? 'missing' : 'ready',
    detached: best.detached,
  };
}

/**
 * One lookup per session of one repository, sharing a single topology read.
 * Sessions whose cwd is outside every worktree are absent from the map — the
 * caller treats "absent" as "an ordinary session", which is the common case.
 */
export async function sessionWorktreeMap(
  primaryRoot: string,
  sessions: readonly { id: string; cwd: string }[],
): Promise<Map<string, SessionWorktreeInfo>> {
  const result = new Map<string, SessionWorktreeInfo>();
  if (sessions.length === 0) return result;

  let entries: WorktreeEntry[];
  try {
    entries = await readProjectWorktrees(primaryRoot);
  } catch {
    // A repository git cannot read has no badges to draw; it must not fail the
    // sidebar, which lists sessions from files rather than from git.
    return result;
  }
  if (entries.length <= 1) return result;

  const resolved = await Promise.all(
    sessions.map(async (session) => ({ id: session.id, info: await worktreeForCwd(entries, session.cwd, primaryRoot) })),
  );
  for (const { id, info } of resolved) {
    if (info) result.set(id, info);
  }
  return result;
}