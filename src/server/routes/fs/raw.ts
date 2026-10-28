/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import { json, type LoaderFunctionArgs } from '@/server/lib/remix-compat';
import { errorResponse } from '@/server/lib/route-adapter';
import { isMockMode } from '@/server/mock.server';
import { getDefaultFsRoot, resolveRoot, resolveWithinRoot } from '@/server/lib/fs/root';
import {
  EDITOR_MAX_BYTES_BY_EXT,
  getFileExtension,
  getRawContentType,
  unsupportedEditorMessage,
} from '@/shared/lib/fs/file-kind';

/**
 * GET /api/fs/raw?path=<rel>&root=<abs>&repo=<rel> — the file's bytes, verbatim.
 *
 * Images reach the editor through this route instead of `/api/fs/read`, which
 * answers with JSON and therefore cannot carry them: a PNG's bytes are not
 * UTF-8, so `Bun.file().text()` returned replacement characters and the panel
 * painted mojibake. The browser can only paint a picture from a real byte
 * stream with a real `content-type`, which is exactly what this returns.
 *
 * The same is now true of the documents the editor renders — a PDF, a DOCX, a
 * workbook — and of SVG. Their viewers fetch the bytes whole and hand them to a
 * parser, so they need a byte stream and a `content-type` that says what they
 * are, not a JSON string. `getRawContentType` is the one table that names them.
 *
 * Scope resolution is identical to `/api/fs/read` (same root allow-list, same
 * `resolveWithinRoot` containment), so a path that reads as text can be served
 * as bytes and vice versa.
 */
export async function serveRawFile({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const filePath = url.searchParams.get('path');

  if (!filePath) {
    return json({ error: 'Missing path' }, { status: 400 });
  }

  let baseDir = await resolveRoot(url.searchParams.get('root'), await getDefaultFsRoot(isMockMode()));

  const repo = url.searchParams.get('repo');
  if (repo && repo !== '.') {
    const repoDir = resolveWithinRoot(baseDir, repo);
    if (repoDir) {
      baseDir = repoDir;
    }
  }

  const cleanPath = filePath.replace(/^\/+/, '');
  const fullPath = resolveWithinRoot(baseDir, cleanPath);

  if (!fullPath) {
    return json({ error: 'Invalid path' }, { status: 403 });
  }

  try {
    const file = Bun.file(fullPath);
    if (!(await file.exists())) {
      return json({ error: 'File not found' }, { status: 404 });
    }
    const stat = await file.stat();
    if (stat.isDirectory()) {
      return json({ error: 'Cannot read a directory' }, { status: 400 });
    }

    // The per-extension ceilings are enforced HERE, at the one route every
    // document viewer's bytes come through, so no entry point can bypass them.
    // The tree's own click never checked a size at all (a 45 MB PDF opened from
    // the Files panel), and a drop went through `/api/fs/scope`, which refuses
    // the TAB rather than the stream — a stale tab, a second browser or a
    // hand-typed URL reached the bytes anyway.
    //
    // The table decides which files are gated, so the gate and the sentence a
    // user reads cannot name different limits. An extension with no entry (an
    // image, an SVG, plain text) is streamed as it always was: an image is
    // painted from the stream and an SVG is text the code surface reads, so
    // neither was ever buffered and neither is refused here.
    const ceiling = EDITOR_MAX_BYTES_BY_EXT[getFileExtension(cleanPath)];
    if (ceiling !== undefined && stat.size > ceiling) {
      return json(
        { error: unsupportedEditorMessage('too-large', stat.size, cleanPath), kind: 'too-large' },
        { status: 415 },
      );
    }

    // `no-store` because a raw read is how a refreshed view sees a file that
    // changed on disk under the same path; an immutable image URL would pin the
    // old bytes for the life of the tab.
    return new Response(file.stream(), {
      headers: {
        'content-type': getRawContentType(cleanPath) ?? 'application/octet-stream',
        'content-length': String(stat.size),
        'content-disposition': `inline; filename="${safeFileName(cleanPath)}"`,
        'cache-control': 'no-store',
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * The filename for `content-disposition`. Only ASCII-printable characters
 * survive: the header is latin-1, and a non-ASCII byte (or a quote) in a
 * filename would either corrupt the header or break out of the quoted string.
 */
function safeFileName(cleanPath: string): string {
  const base = cleanPath.split('/').pop() ?? 'file';
  const ascii = base.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return ascii || 'file';
}
