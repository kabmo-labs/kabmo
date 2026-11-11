/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * GET /api/fs/digest?path=<rel>&root=<abs>&repo=<rel> — the content fingerprint
 * of a file inside the panel's scope.
 *
 * The editor polls this while a tab is open so a file changed from OUTSIDE the
 * console (an agent's tool call, `git checkout`, another editor) reaches the
 * buffer without the user reloading anything. The question is deliberately not
 * "did the mtime move": a checkout or a formatter rewrites a file with bytes
 * the buffer may already hold, and reloading over that would drop a caret and a
 * scroll position for no change at all. The answer is the hash of the content,
 * so the caller replaces its buffer only when the bytes really differ.
 *
 * Scope resolution is identical to `/api/fs/exists` and `/api/fs/read` (same
 * root allow-list, same `resolveWithinRoot` containment), so a path that reads
 * as text is a path whose digest can be asked about.
 *
 * The hash is CACHED per path against the raw mtime and size, because a 3s poll
 * of a 30 MB file would otherwise re-read and re-hash it forever. The cache's
 * blind spot is the one the save path already documents: a write that leaves
 * both the size and the millisecond-identical mtime unchanged is not seen until
 * something else moves. `touch`ing a file invalidates the entry and re-reads —
 * the answer is then the same hash, which is exactly what "the bytes did not
 * change" means.
 */

import { json, type LoaderFunctionArgs } from '@/server/lib/remix-compat';
import { isMockMode } from '@/server/mock.server';
import { getDefaultFsRoot, resolveRoot, resolveWithinRoot } from '@/server/lib/fs/root';
import { stableMtime } from '@/server/lib/fs/write-conflict';
import { contentHash } from '@/shared/lib/fs/content-hash';
import { EDITOR_MAX_FILE_BYTES } from '@/shared/lib/fs/file-kind';

interface CachedDigest {
  /** The RAW stat mtime the hash was built from; never the rounded value. */
  mtimeMs: number;
  size: number;
  hash: string;
}

/** One entry per open tab is the normal size; the cap only bounds a leak. */
const CACHE_LIMIT = 64;
const HASH_CACHE = new Map<string, CachedDigest>();

function cacheDigest(fullPath: string, digest: CachedDigest): void {
  HASH_CACHE.delete(fullPath);
  HASH_CACHE.set(fullPath, digest);
  while (HASH_CACHE.size > CACHE_LIMIT) {
    const oldest = HASH_CACHE.keys().next().value;
    if (oldest === undefined) break;
    HASH_CACHE.delete(oldest);
  }
}

export async function fileDigest({ request }: LoaderFunctionArgs) {
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

  // A directory standing where the file was is "gone" for the same reason the
  // existence probe answers that way: the file the tab names is not there.
  const stat = await Bun.file(fullPath).stat().catch(() => null);
  if (!stat || stat.isDirectory()) {
    return json({ exists: false, mtimeMs: null, hash: null });
  }

  // A file past the editor's ceiling was never openable, and hashing it would
  // cost the read this route exists to avoid. `null` tells the caller it has no
  // fingerprint to compare against.
  if (stat.size > EDITOR_MAX_FILE_BYTES) {
    return json({ exists: true, mtimeMs: stableMtime(stat.mtimeMs), hash: null });
  }

  const cached = HASH_CACHE.get(fullPath);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
    return json({ exists: true, mtimeMs: stableMtime(stat.mtimeMs), hash: cached.hash });
  }

  try {
    const hash = await contentHash(await Bun.file(fullPath).text());
    cacheDigest(fullPath, { mtimeMs: stat.mtimeMs, size: stat.size, hash });
    return json({ exists: true, mtimeMs: stableMtime(stat.mtimeMs), hash });
  } catch {
    // An unreadable file has no verdict — the caller must not treat a failed
    // probe as "the disk changed".
    return json({ exists: true, mtimeMs: stableMtime(stat.mtimeMs), hash: null });
  }
}
