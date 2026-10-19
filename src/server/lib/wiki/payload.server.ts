/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * One wiki's tree, as the panel renders it.
 *
 * Extracted from `routes/wiki/repo.ts` so the HTTP route and the realtime
 * `wiki:` topic share one implementation: the mirror TTL, the provider probe
 * and the sidebar merge are the details two copies would drift on.
 */

import { isMockMode } from '@/server/mock.server';
import { scopeToRepo } from '@/server/lib/fs/repo-scope';
import { firstLine, gitRun } from '@/server/lib/wiki/git';
import { ensureWikiMirror, listWikiPaths, readWikiPage } from '@/server/lib/wiki/mirror.server';
import { detectWikiProvider } from '@/server/lib/wiki/provider.server';
import { parseWikiRemote, redactRemoteUrl, wikiWebUrl } from '@/server/lib/wiki/remote';
import { buildWikiEntries } from '@/shared/lib/wiki/pages';
import { findWikiSidebarPath, parseWikiSidebar, withRemainingPages } from '@/shared/lib/wiki/sidebar';
import type { WikiNavSection, WikiRepoPayload } from '@/shared/types/wiki';

/** The checkout's `origin`; null when there is none to read. */
async function readOriginRemote(dir: string): Promise<{ remote: string | null; error: string }> {
  const out = await gitRun(['-C', dir, 'remote', 'get-url', 'origin'], { timeoutMs: 5_000 });
  if (out.exitCode !== 0) return { remote: null, error: firstLine(out.stderr) };
  return { remote: out.stdout.trim() || null, error: '' };
}

/** MOCK=true: a deterministic wiki so the panel renders its full range offline. */
function mockPayload(): WikiRepoPayload {
  const entries = buildWikiEntries([
    'Home.md',
    'Getting-Started.md',
    'guides/Deployment.md',
    'guides/Troubleshooting.md',
    'change_logs/v1.0.0.md',
    'images/diagram.svg',
    '_Sidebar.md',
    '.gitlab/redirects.yml',
  ]);
  return {
    repo: {
      provider: 'github',
      host: 'github.com',
      slug: 'kabmo/demo',
      remote: 'https://github.com/kabmo/demo',
      webUrl: 'https://github.com/kabmo/demo/wiki',
      revision: '0000000000000000000000000000000000000000',
      updatedAt: new Date().toISOString(),
    },
    entries,
    sidebar: null,
    generatedAt: new Date().toISOString(),
    isMock: true,
  };
}

export async function buildWikiRepoPayload(
  rootDir: string,
  repo: string,
  options: { refresh?: boolean } = {},
): Promise<WikiRepoPayload> {
  const generatedAt = new Date().toISOString();

  if (isMockMode()) return mockPayload();

  const targetDir = await scopeToRepo(rootDir, repo);

  const { remote, error } = await readOriginRemote(targetDir);
  if (!remote) {
    const payload: WikiRepoPayload = {
      repo: null,
      entries: [],
      reason: 'no-remote',
      detail: error || 'This repository has no origin remote',
      generatedAt,
      isMock: false,
    };
    return payload;
  }

  const parsed = parseWikiRemote(remote);
  if (!parsed) {
    const payload: WikiRepoPayload = {
      repo: null,
      entries: [],
      reason: 'unsupported-remote',
      detail: `No wiki can be derived from ${redactRemoteUrl(remote)}`,
      generatedAt,
      isMock: false,
    };
    return payload;
  }

  const mirror = await ensureWikiMirror(parsed.host, parsed.slug, parsed.wikiRemote, options.refresh === true);
  if (!mirror.ok) {
    const payload: WikiRepoPayload = {
      repo: null,
      entries: [],
      reason: mirror.reason,
      detail: mirror.detail,
      generatedAt,
      isMock: false,
    };
    return payload;
  }

  // Probed only now, when the host is known to be reachable and a wiki exists.
  const provider = await detectWikiProvider(parsed.host);
  const paths = await listWikiPaths(mirror.mirror.repoDir);
  const entries = buildWikiEntries(paths);

  // The wiki's own navigation, when the author wrote one: the panel renders its
  // grouping and labels instead of re-deriving a tree from the file layout. Any
  // page it does not mention is appended, so nothing becomes unreachable.
  const sidebarPath = findWikiSidebarPath(paths);
  let sidebar: WikiNavSection[] | null = null;
  if (sidebarPath) {
    const file = await readWikiPage(mirror.mirror.repoDir, sidebarPath);
    if (file.ok) sidebar = withRemainingPages(parseWikiSidebar(file.text, sidebarPath, entries), entries);
  }

  const payload: WikiRepoPayload = {
    repo: {
      provider,
      host: parsed.host,
      slug: parsed.slug,
      remote: redactRemoteUrl(remote),
      webUrl: wikiWebUrl(provider, parsed.host, parsed.slug),
      revision: mirror.mirror.revision,
      updatedAt: mirror.mirror.updatedAt,
    },
    entries,
    sidebar,
    generatedAt,
    isMock: false,
  };
  return payload;
}
