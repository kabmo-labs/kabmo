/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * `GET /api/wiki/asset` — an image a wiki page references, read out of the
 * wiki's own tree.
 *
 * A wiki's images live in the wiki repository, not in the project's: draw.io's
 * wiki keeps `images/schema.png` beside its pages, and a self-hosted GitLab wiki
 * keeps `change_logs/` the same way. There is therefore no URL on the project
 * host to point an `<img>` at, and the panel must serve the bytes itself.
 *
 * Two headers are load-bearing. `nosniff` plus an explicit content type, because
 * a wiki's tree is author-controlled content rendered by the same origin; and a
 * `sandbox` CSP, which is what keeps an SVG in that tree from running script if
 * a reader opens the asset URL directly — the same pair GitHub's own raw
 * endpoint sends.
 */

import { json, type LoaderFunctionArgs } from '@/server/lib/remix-compat';
import { resolveRoot } from '@/server/lib/fs/root';
import { scopeToRepo } from '@/server/lib/fs/repo-scope';
import { getImageMimeType } from '@/shared/lib/fs/file-kind';
import { gitRun } from '@/server/lib/wiki/git';
import { ensureWikiMirror, readWikiAsset } from '@/server/lib/wiki/mirror.server';
import { parseWikiRemote } from '@/server/lib/wiki/remote';
import { bodyBytes } from '@/shared/lib/util/bytes';

/**
 * `getImageMimeType` deliberately excludes SVG (it is editable text in the
 * editor's own viewers), but a wiki asset route has to name it: a wiki that
 * embeds a diagram serves `image/svg+xml` or the browser shows nothing.
 */
function contentTypeFor(assetPath: string): string {
  const image = getImageMimeType(assetPath);
  if (image) return image;
  if (/\.svg$/i.test(assetPath)) return 'image/svg+xml';
  return 'application/octet-stream';
}

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const assetPath = url.searchParams.get('path');
  if (!assetPath) return json({ error: 'path is required' }, { status: 400 });

  const rootDir = await resolveRoot(url.searchParams.get('root'), process.cwd());
  const targetDir = await scopeToRepo(rootDir, url.searchParams.get('repo'));

  const origin = await gitRun(['-C', targetDir, 'remote', 'get-url', 'origin'], { timeoutMs: 5_000 });
  const parsed = origin.exitCode === 0 ? parseWikiRemote(origin.stdout.trim()) : null;
  if (!parsed) return json({ error: 'No wiki for this repository' }, { status: 404 });

  const mirror = await ensureWikiMirror(parsed.host, parsed.slug, parsed.wikiRemote);
  if (!mirror.ok) return json({ error: mirror.detail || 'The wiki is unavailable' }, { status: 404 });

  const bytes = await readWikiAsset(mirror.mirror.repoDir, assetPath);
  if (!bytes) return json({ error: `Asset not found: ${assetPath}` }, { status: 404 });

  return new Response(bodyBytes(bytes), {
    headers: {
      'content-type': contentTypeFor(assetPath),
      'content-length': String(bytes.byteLength),
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    },
  });
}
