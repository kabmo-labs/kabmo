/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * `GET /api/wiki` — the wiki behind the repository the right-panel scope points
 * at: its provider, its commit, and every path in its tree.
 *
 * Scope resolution is the same `root` + `repo` pair every other right-panel view
 * takes (see `@/server/lib/fs/root` and `@/server/lib/fs/repo-scope`), so the
 * Wiki view follows the picker the Files, Search, Git and Terminal views share
 * and cannot end up describing a different repository.
 *
 * The payload itself is built in `lib/wiki/payload.server.ts`, so this route and
 * the realtime `wiki:` topic answer from one implementation.
 */

import { json, type LoaderFunctionArgs } from '@/server/lib/remix-compat';
import { resolveRoot } from '@/server/lib/fs/root';
import { buildWikiRepoPayload } from '@/server/lib/wiki/payload.server';

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const rootDir = await resolveRoot(url.searchParams.get('root'), process.cwd());
  const payload = await buildWikiRepoPayload(rootDir, url.searchParams.get('repo') ?? '.', {
    refresh: url.searchParams.get('refresh') === '1',
  });
  return json(payload);
}
