/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * `GET /api/wiki/page` — one wiki page's markdown source.
 *
 * The path is read at the wiki's own ref (`git show <ref>:<path>`), so it can
 * only name a blob inside the wiki's tree; a crafted `../` cannot reach outside
 * it. Nothing is rendered here: the source travels verbatim and the panel runs
 * it through the app's own markdown pipeline, which is what gives a wiki page
 * the same sanitizing, syntax highlighting and mermaid hydration the chat
 * timeline has.
 */

import { json, NO_STORE_HEADERS, type LoaderFunctionArgs } from '@/server/lib/remix-compat';
import { isMockMode } from '@/server/mock.server';
import { resolveRoot } from '@/server/lib/fs/root';
import { scopeToRepo } from '@/server/lib/fs/repo-scope';
import { gitRun } from '@/server/lib/wiki/git';
import { ensureWikiMirror, readWikiPage } from '@/server/lib/wiki/mirror.server';
import { parseWikiRemote } from '@/server/lib/wiki/remote';
import type { WikiPagePayload } from '@/shared/types/wiki';

/** MOCK=true: a page that exercises the renderer (table, mermaid, code, link). */
const MOCK_PAGE = `# Getting Started

Welcome to the **demo wiki**. This page exists so the panel renders every block
kind without an omp install.

| Step | Command | Notes |
| ---- | ------- | ----- |
| 1 | \`bun install\` | installs deps |
| 2 | \`bun run dev\` | starts the server |

\`\`\`mermaid
graph LR
    A[Reader] --> B[Wiki panel]
    B --> C[git show]
\`\`\`

\`\`\`ts
export function greet(name: string): string {
  return \`hello \${name}\`;
}
\`\`\`

See the [deployment guide](guides/Deployment) for the rest.
`;

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const pagePath = url.searchParams.get('path');

  if (isMockMode()) {
    const payload: WikiPagePayload = {
      path: pagePath ?? 'Home.md',
      content: MOCK_PAGE,
      truncated: false,
      generatedAt: new Date().toISOString(),
    };
    return json(payload, { headers: NO_STORE_HEADERS });
  }

  if (!pagePath) return json({ error: 'path is required' }, { status: 400 });

  const rootDir = await resolveRoot(url.searchParams.get('root'), process.cwd());
  const targetDir = await scopeToRepo(rootDir, url.searchParams.get('repo'));

  const origin = await gitRun(['-C', targetDir, 'remote', 'get-url', 'origin'], { timeoutMs: 5_000 });
  const parsed = origin.exitCode === 0 ? parseWikiRemote(origin.stdout.trim()) : null;
  if (!parsed) return json({ error: 'No wiki for this repository' }, { status: 404 });

  const mirror = await ensureWikiMirror(parsed.host, parsed.slug, parsed.wikiRemote);
  if (!mirror.ok) return json({ error: mirror.detail || 'The wiki is unavailable' }, { status: 404 });

  const page = await readWikiPage(mirror.mirror.repoDir, pagePath);
  if (!page.ok) return json({ error: page.error }, { status: 404 });

  const payload: WikiPagePayload = {
    path: pagePath,
    content: page.text,
    truncated: page.truncated,
    generatedAt: new Date().toISOString(),
  };
  return json(payload, { headers: NO_STORE_HEADERS });
}
