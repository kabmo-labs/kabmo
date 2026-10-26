/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * GET /api/fs/exists?path=<rel>&root=<abs>&repo=<rel> — whether a path still
 * names something inside the panel's scope.
 *
 * A read cannot answer this. `/api/fs/read` reports a missing file as a 404, but
 * the editor caches every tab's bytes and deliberately KEEPS them on a failed
 * re-read (`useFileEditor` reports only a first load's failure), so a file
 * deleted while its tab is open leaves the buffer on screen and no error
 * anywhere. The tab strip needs the narrower question — "is the thing this tab
 * names still there?" — asked without dragging the file's contents back.
 *
 * Scope resolution is identical to `/api/fs/read` and `/api/fs/raw` (same root
 * allow-list, same `resolveWithinRoot` containment), so a path that reads as
 * text is a path whose existence can be asked about.
 */

import { json, type LoaderFunctionArgs } from '@/server/lib/remix-compat';
import { isMockMode } from '@/server/mock.server';
import { getDefaultFsRoot, resolveRoot, resolveWithinRoot } from '@/server/lib/fs/root';
import { stableMtime } from '@/server/lib/fs/write-conflict';

export async function fileExists({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const filePath = url.searchParams.get('path');
  if (!filePath) {
    return json({ error: 'Missing path' }, { status: 400 });
  }

  let baseDir = await resolveRoot(url.searchParams.get('root'), await getDefaultFsRoot(isMockMode()));
  const repo = url.searchParams.get('repo');
  if (repo && repo !== '.') {
    const repoDir = resolveWithinRoot(baseDir, repo);
    if (repoDir) baseDir = repoDir;
  }

  const fullPath = resolveWithinRoot(baseDir, filePath.replace(/^\/+/, ''));
  if (!fullPath) {
    return json({ error: 'Invalid path' }, { status: 403 });
  }

  // `stat`, not `Bun.file().exists()`: `exists()` answers `false` for a
  // DIRECTORY (measured on Bun 1.4.2 — `/tmp` reports false while `stat()`
  // reports `isDirectory()` true), so a probe built on it would have been right
  // about a folder only by accident. The question here is whether the FILE the
  // tab names is still there, so a folder standing in its place is a "no" —
  // the file was deleted and something else took its path.
  //
  // The mtime travels beside the answer because the editor's change detection asks
  // this exact question — "does the file the buffer came from still look like the
  // one it read?" — and a second route for one `stat` would be a second scope
  // check to keep in step. `null` when there is no file to report on.
  const stat = await Bun.file(fullPath).stat().catch(() => null);
  const exists = stat !== null && !stat.isDirectory();
  // Rounded to a whole millisecond: `node:fs` and `Bun.file()` disagree on the
  // fractional part, and the editor compares this value against the one the read
  // route reported. See `stableMtime`.
  return json({ exists, mtimeMs: exists ? stableMtime(stat.mtimeMs) : null });
}
