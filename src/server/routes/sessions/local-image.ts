/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * GET /api/sessions/:sessionId/local-image?path=<abs or relative path>
 *
 * The bytes of an image an agent put in its answer as markdown. A chat message
 * is not a document preview: `![shot](/Users/me/project/shot.png)` names a file
 * on the machine running the console, and neither `/Users/…` (requested from
 * the app's origin) nor `file:///…` (refused by the browser) can paint it.
 *
 * The route reads only inside two places, both derived from the session row the
 * caller asked for:
 *
 *  - the session's cwd (a relative reference resolves there, and an absolute
 *    one must land inside it), and
 *  - the harness's own artifact directory for that session — antigravity writes
 *    generated pictures under `<home>/antigravity-cli/brain/<session>/`.
 *
 * A path outside both is refused rather than served: the fs allow-list exists
 * because a page must not turn into a filesystem read, and an agent's answer is
 * still page input by the time this route sees it. That is also why only the
 * raster formats are served — an SVG is a document, and opening one from this
 * origin would execute whatever script it carries.
 */

import path from 'node:path';
import { antigravityHome } from '@kabmo-labs/kabmo-harness/local-transcript/antigravity-home';
import { json, type LoaderFunctionArgs } from '@kabmo-labs/kabmo-http';
import { isWithinRoot, resolveScopeForAbsolutePath } from '@kabmo-labs/kabmo-workspace/root/root';
import { loadHarnessSession } from '@kabmo-labs/kabmo-harness/session/session-store.server';
import { resolveSessionPathOr404 } from '@kabmo-labs/kabmo-omp/session-locator';
import { getRawContentType } from '@kabmo-labs/kabmo-fs/media/mime';
import { pathFromFileUrl } from '@/shared/lib/fs/file-url';

/** A generated picture is a preview, not a download; the cap keeps a mistaken
 *  huge file from becoming a memory spike in the browser. */
export const SESSION_IMAGE_MAX_BYTES = 25 * 1024 * 1024;

const RASTER_MIME: Record<string, true> = {
  'image/png': true,
  'image/jpeg': true,
  'image/gif': true,
  'image/webp': true,
  'image/avif': true,
  'image/bmp': true,
  'image/x-icon': true,
  'image/vnd.microsoft.icon': true,
};

/** The harness artifact directories a session's own images may live in. */
export function sessionArtifactRoots(harness: string | null, agentSessionId: string): string[] {
  if (harness !== 'antigravity' || !agentSessionId) return [];
  const home = antigravityHome();
  return [
    path.join(home, 'antigravity-cli', 'brain', agentSessionId),
    path.join(home, 'antigravity', 'brain', agentSessionId),
  ];
}

/**
 * Resolve a chat image reference under the session's own roots, or null.
 *
 * `cwd` is the base for a relative reference; an absolute one is used as
 * written and must still land inside a root. `file://` is accepted here because
 * the shared renderer hands the path over decoded, but a URL that reaches this
 * function by another route is still a path, not permission.
 */
export function resolveSessionImagePath(
  reference: string,
  cwd: string | null,
  artifactRoots: readonly string[],
): string | null {
  const fromFileUrl = pathFromFileUrl(reference) ?? reference;
  if (!fromFileUrl || fromFileUrl.includes('\0')) return null;

  const roots = [...(cwd ? [path.resolve(cwd)] : []), ...artifactRoots.map((root) => path.resolve(root))];
  if (roots.length === 0) return null;

  const candidate = path.resolve(cwd ?? roots[0], fromFileUrl);
  const inside = roots.some((root) => isWithinRoot(root, candidate));
  return inside ? candidate : null;
}

/** The image's MIME, or null when the extension is not a raster picture. */
export function sessionImageMime(filePath: string): string | null {
  const mime = getRawContentType(filePath);
  return mime && RASTER_MIME[mime] ? mime : null;
}

export async function serveSessionImage({ params, request }: LoaderFunctionArgs) {
  const sessionId = params.sessionId;
  if (!sessionId) return json({ error: 'Missing session id' }, { status: 400 });

  const reference = new URL(request.url).searchParams.get('path');
  if (!reference) return json({ error: 'Missing path' }, { status: 400 });

  const harness = await loadHarnessSession(sessionId);
  let cwd = harness?.cwd ?? null;
  if (!cwd) {
    const located = await resolveSessionPathOr404(sessionId);
    if ('response' in located) return located.response;
    cwd = located.recordedCwd;
  }

  const artifactRoots = sessionArtifactRoots(harness?.harness ?? null, harness?.agentSessionId ?? sessionId);
  let fullPath = resolveSessionImagePath(reference, cwd, artifactRoots);

  // An omp session has no harness row; its file header is the cwd. A session
  // whose cwd is no longer inside an allow-listed root still answers for the
  // workspace the file itself names, through the same rule the editor uses.
  if (!fullPath) {
    const scope = await resolveScopeForAbsolutePath(reference);
    if (scope) fullPath = path.resolve(scope.root, scope.path);
  }

  if (!fullPath) return json({ error: 'Image is outside this session' }, { status: 403 });

  const mime = sessionImageMime(fullPath);
  if (!mime) return json({ error: 'Not an image' }, { status: 415 });

  const file = Bun.file(fullPath);
  if (!(await file.exists())) return json({ error: 'File not found' }, { status: 404 });
  const stat = await file.stat();
  if (stat.isDirectory()) return json({ error: 'Not a file' }, { status: 400 });
  if (stat.size > SESSION_IMAGE_MAX_BYTES) {
    return json({ error: 'Image is too large to preview' }, { status: 413 });
  }

  return new Response(file.stream(), {
    headers: {
      'content-type': mime,
      'content-length': String(stat.size),
      'content-disposition': 'inline',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}
