/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The WORKSPACE-scoped topics: `git:<root>\0<repo>`, `fs:<scope>`,
 * `repos:<root>` and `wiki:<scope>`.
 *
 * All four describe one working tree and take the panel's own scope string
 * (`root\0repo`, or a bare root for repo discovery) — the same key
 * `workspace.activeRepo` stores, so a scope that names no resolvable root is
 * refused rather than answered for the wrong tree.
 *
 * Each resolver calls the SAME lib function its HTTP route does, so a panel
 * renders one answer whichever path delivered it.
 */

import { type TopicDescriptor } from '@/server/lib/realtime/hub.server';
import { getDefaultFsRoot, resolveRoot, resolveWithinRoot } from '@/server/lib/fs/root';
import { readGitStatus } from '@/server/lib/fs/git-status-read';
import { listDirectoryEntries } from '@/server/lib/fs/listing';
import { discoveredRepos, startRepoScan } from '@/server/lib/fs/git-repos';
import { buildWikiRepoPayload } from '@/server/lib/wiki/payload.server';

/**
 * Split a workspace topic's scope into its root and repo parts.
 *
 * The root is resolved through `resolveRoot`, which is the security boundary: a
 * topic may only name a tree the caller could have asked for over HTTP, and an
 * unresolvable root answers null rather than a default nobody asked for.
 */
async function resolveScope(scope: string): Promise<{ root: string; repo: string } | null> {
  const separator = scope.indexOf('\u0000');
  const rootPart = separator === -1 ? scope : scope.slice(0, separator);
  const repo = (separator === -1 ? '.' : scope.slice(separator + 1)) || '.';
  const root = await resolveRoot(rootPart || null, await getDefaultFsRoot(false));
  if (!root) return null;
  return { root, repo };
}

/**
 * One working tree's git status, as the panel renders its change list.
 *
 * The count is `local`, never `fetch`: the panel renders this topic's payload
 * as its change list, and the ahead/behind it carries must therefore follow
 * every push a tool call makes. A fetch here would be a network round trip per
 * publish, so the badge would still read the pre-push numbers — the bug this
 * replaces. The panel's own read (`?sync=1`) is what refreshes the tracking ref
 * before counting, which is why `behind` becomes honest on mount and Refresh.
 */
async function gitResolve(scope: string): Promise<unknown> {
  const parsed = await resolveScope(scope);
  if (!parsed) return null;
  const targetDir = parsed.repo === '.' ? parsed.root : resolveWithinRoot(parsed.root, parsed.repo);
  if (!targetDir) return null;
  return readGitStatus(targetDir, { count: 'local' });
}

/** One working tree's root listing, as the file explorer renders it. */
async function fsResolve(scope: string): Promise<unknown> {
  const parsed = await resolveScope(scope);
  if (!parsed) return null;
  const baseDir = parsed.repo === '.' ? parsed.root : resolveWithinRoot(parsed.root, parsed.repo);
  if (!baseDir) return null;
  try {
    return { files: await listDirectoryEntries(baseDir, baseDir), root: baseDir, path: '.' };
  } catch {
    return null;
  }
}

/** One workspace root's nested repositories, and whether discovery is running. */
async function reposResolve(scope: string): Promise<unknown> {
  const root = await resolveRoot(scope || null, await getDefaultFsRoot(false));
  if (!root) return null;
  startRepoScan(root);
  const { repos, pending } = discoveredRepos(root);
  return { repos, reposPending: pending };
}

/** One wiki's tree, scoped by `root\0repo`. */
async function wikiResolve(scope: string): Promise<unknown> {
  const parsed = await resolveScope(scope);
  if (!parsed) return null;
  return buildWikiRepoPayload(parsed.root, parsed.repo);
}

const RESOLVERS: Record<string, (scope: string) => Promise<unknown>> = {
  git: gitResolve,
  fs: fsResolve,
  repos: reposResolve,
  wiki: wikiResolve,
};

/**
 * A descriptor for one workspace family. The resolver is picked by family name,
 * so a prefix with no resolver is a topic the hub does not serve.
 */
export function workspaceDescriptor(family: string): (scope: string) => TopicDescriptor {
  return (scope) => {
    const resolve = RESOLVERS[family];
    if (!resolve) throw new Error(`No workspace resolver for ${family}`);
    return { resolve: () => resolve(scope) };
  };
}
