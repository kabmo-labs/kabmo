/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Nested-repository discovery for the right-panel repo picker.
 *
 * A workspace is often a folder OF repositories (`projects/<name>/<sub>/.git`),
 * so the picker lists every repo under the scoped root. The walk is expensive
 * on a deep tree, so it runs in the BACKGROUND after the loader has already
 * answered with the root's own status; the client never polls for it — the walk
 * emits `repos-scanned`, which republishes the `repos:<root>` topic the client
 * subscribes to. Results are cached per scoped root for the life of the process.
 *
 * The walk prunes `node_modules` (the one directory guaranteed to hold
 * unrelated `.git` directories, and the one that makes the walk unbounded) and
 * stops at `MAX_GIT_DEPTH`.
 *
 * It is a JS walk rather than `find`, and the readdir is `withFileTypes` so a
 * directory test costs no syscall: `find` needed a subprocess and a 1 MB stdout
 * pipe, and measured 302 ms against 142 ms for the walk on a real workspace
 * root, for the identical repo set (verified: 206 == 206, no element in one and
 * not the other). Pre-order traversal in readdir order matches `find`'s, so the
 * picker's list order is unchanged.
 */

import fs from 'fs';
import path from 'path';
import { emitRealtimeSignal } from '@/server/lib/realtime/signals.server';

const MAX_GIT_DEPTH = 8;

/**
 * Repos under `rootDir`, as root-relative POSIX paths (`.` for the root itself).
 *
 * `depth` is the depth of `dir` itself: the root is 0, so an entry inside it is
 * at depth 1 and `MAX_GIT_DEPTH` bounds an entry's own depth exactly as `find
 * -maxdepth` does.
 */
async function findGitDirs(dir: string, rel: string, depth: number, out: string[]): Promise<void> {
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    // Unreadable directory (permissions, a race) — skip it, never fail the walk.
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name === 'node_modules') continue;
    if (entry.name === '.git') {
      out.push(rel || '.');
      continue;
    }
    if (depth + 1 < MAX_GIT_DEPTH) {
      await findGitDirs(path.join(dir, entry.name), rel ? `${rel}/${entry.name}` : entry.name, depth + 1, out);
    }
  }
}

async function getRepos(rootDir: string): Promise<string[]> {
  const found: string[] = [];
  await findGitDirs(rootDir, '', 0, found);
  // SORTED, because `readdir` is filesystem order and everything downstream
  // picks a DEFAULT from this list. Two consumers take `repos[0]` when the
  // session has no pick — the git route's implicit repo and the panel's
  // `resolveRepoForPanel` — so an unsorted list made "which repository am I
  // looking at" differ between two machines reading the same workspace, and
  // between two reads of the same one. Measured: `readdir` returned
  // `['conflicted', 'alpha']` for a directory created in the other order, which
  // is what made the repository-modal spec select `alpha` and then find its row
  // labelled "Already showing" instead of "Show alpha". `groupRepos` already
  // sorts for display, so this only makes the SOURCE agree with it.
  const uniqueRepos = Array.from(new Set(found)).sort((a, b) => a.localeCompare(b));
  if (uniqueRepos.includes('.')) {
    return ['.', ...uniqueRepos.filter((r) => r !== '.')];
  }
  return uniqueRepos.length ? uniqueRepos : ['.'];
}

interface RepoDiscovery {
  repos: string[];
  done: boolean;
}

const repoDiscovery = new Map<string, RepoDiscovery>();

/** Begin the background walk for `rootDir`; a no-op once one has started. */
export function startRepoScan(rootDir: string): void {
  if (repoDiscovery.has(rootDir)) return;
  const d: RepoDiscovery = { repos: ['.'], done: false };
  repoDiscovery.set(rootDir, d);
  void getRepos(rootDir)
    .then(repos => { d.repos = repos; d.done = true; })
    .catch(() => { d.repos = ['.']; d.done = true; })
    // The walk is STARTED by a read, so this completion is the only moment the
    // list becomes final — the `repos:` topic is re-snapshotted from it, and a
    // client watching the root never has to poll for the answer.
    .finally(() => emitRealtimeSignal('repos-scanned', undefined, rootDir));
}

/**
 * Drop the cached result for `rootDir` and start a fresh walk. Used by the
 * repo-switcher's refresh button, which must not serve the previous answer.
 */
export function rescanRepos(rootDir: string): void {
  repoDiscovery.delete(rootDir);
  startRepoScan(rootDir);
}

/** The discovered repos for `rootDir`, and whether the walk is still running. */
export function discoveredRepos(rootDir: string): { repos: string[]; pending: boolean } {
  const d = repoDiscovery.get(rootDir);
  if (!d) return { repos: ['.'], pending: false };
  return { repos: d.done ? d.repos : ['.'], pending: !d.done };
}
