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
import { emitRealtimeSignal } from '@kabmo-labs/kabmo-realtime-signals';

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

/**
 * Begin a background walk for `rootDir`, seeded with the list the client should
 * see while it runs.
 *
 * The seed is why this is not inlined into `startRepoScan`: a FORCED rescan
 * answers with the previous list, so the picker keeps the rows (and the pick's
 * own row) instead of collapsing to the bare root for the length of the walk.
 */
function beginScan(rootDir: string, seed: string[]): void {
  const d: RepoDiscovery = { repos: seed, done: false };
  repoDiscovery.set(rootDir, d);
  void getRepos(rootDir)
    // A newer scan may have replaced this entry (two rescans in flight, or a
    // walk that outlived a rescan): only the CURRENT walk owns the cache.
    .then(repos => { if (repoDiscovery.get(rootDir) === d) { d.repos = repos; d.done = true; } })
    .catch(() => { if (repoDiscovery.get(rootDir) === d) { d.repos = ['.']; d.done = true; } })
    // The walk is STARTED by a read, so this completion is the only moment the
    // list becomes final — the `repos:` topic is re-snapshotted from it, and a
    // client watching the root never has to poll for the answer.
    .finally(() => {
      if (repoDiscovery.get(rootDir) === d) emitRealtimeSignal('repos-scanned', undefined, rootDir);
    });
}

/** Begin the background walk for `rootDir`; a no-op once one has started. */
export function startRepoScan(rootDir: string): void {
  if (repoDiscovery.has(rootDir)) return;
  beginScan(rootDir, ['.']);
}

/**
 * Start a fresh walk for `rootDir`, ignoring the cached result. Used by the
 * repo-switcher's refresh button, which must not serve the previous answer.
 *
 * The PREVIOUS list is published while the new walk runs: the topic would
 * otherwise report `['.']` as if discovery had found one repository, and every
 * picker on the root dropped its nested rows — including the selected one —
 * until the walk finished.
 */
export function rescanRepos(rootDir: string): void {
  const previous = repoDiscovery.get(rootDir)?.repos ?? ['.'];
  beginScan(rootDir, previous);
}

/** The discovered repos for `rootDir`, and whether the walk is still running. */
export function discoveredRepos(rootDir: string): { repos: string[]; pending: boolean } {
  const d = repoDiscovery.get(rootDir);
  if (!d) return { repos: ['.'], pending: false };
  return { repos: d.repos, pending: !d.done };
}
