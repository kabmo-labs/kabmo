/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The wiki mirror: one bare, shallow git clone per wiki, read with `ls-tree`
 * and `show`.
 *
 * Reading a wiki over git rather than over an API is what makes one
 * implementation cover GitHub, GitLab and a self-hosted GitLab: all three
 * publish the same `.wiki.git` repository, so the fetch is the checkout's own
 * remote with a suffix and nothing else differs. See `./remote`.
 *
 * Five properties of this module are deliberate:
 *
 *   - **One ref, not a working tree.** `HEAD:refs/wiki/latest` is fetched
 *     directly into a bare repository, so there is no checkout to keep in sync
 *     and no second copy of the pages on disk. Verified against
 *     `github.com/jgraph/drawio.wiki.git` (19 paths, 1.2 MB, ~1.9 s cold) and
 *     `git-rbi.jatismobile.com/jns6_5/drrealhandler.wiki.git` (7 paths, 0.7 s).
 *   - **Shallow.** `--depth 1` keeps a wiki's whole history — which for a
 *     changelog wiki is the bulk of it — out of the cache. A re-fetch costs
 *     ~1.1 s and is TTL'd, so the panel's poll is not a fetch loop.
 *   - **No credential on disk.** `--no-write-fetch-head` keeps the fetch from
 *     writing `FETCH_HEAD`, and a refspec (rather than a named remote) keeps the
 *     credential-carrying URL out of `.git/config` entirely — verified: neither
 *     file mentions the remote the fetch used.
 *   - **A missing wiki is an answer, not an error.** Git answers "Repository not
 *     found" / "Authentication failed" for a wiki that does not exist and one
 *     Kabmo cannot read, and both mean the same thing to a reader: there
 *     is nothing to show. They map to `no-wiki` so the panel can say so instead
 *     of reporting a failure.
 *   - **A page is read at the ref, never off a path.** `git show <ref>:<path>`
 *     can only name a blob in the wiki's own tree, so a crafted path cannot
 *     reach outside it.
 */

import fs from 'fs';
import path from 'path';
import { getDataDir } from '@/server/lib/lifecycle/paths';
import { firstLine, gitRun, type GitRun } from '@/server/lib/wiki/git';
import type { WikiUnavailableReason } from '@/shared/types/wiki';
import { childEnv } from '@/server/lib/fs/child-env';

/** How long a mirror is trusted before a read re-fetches it. */
const MIRROR_TTL_MS = 60_000;
/** Hard budget for one fetch; a wiki that cannot answer within it is unreachable. */
const FETCH_TIMEOUT_MS = 20_000;
/** Hard budget for the local reads (`ls-tree`, `show`). */
const READ_TIMEOUT_MS = 5_000;
/**
 * A page longer than this is cut, in characters. A wiki page past two million
 * characters is pathological, and the panel renders it synchronously.
 */
export const MAX_WIKI_PAGE_CHARS = 2_000_000;
/** An asset larger than this is refused rather than loaded into the response. */
const MAX_WIKI_ASSET_BYTES = 8 * 1024 * 1024;

const REF = 'refs/wiki/latest';

export interface WikiMirror {
  /** Bare repository holding the wiki. */
  repoDir: string;
  /** Commit the mirror is at. */
  revision: string;
  /** ISO timestamp of that commit. */
  updatedAt: string;
}

export type WikiMirrorResult =
  | { ok: true; mirror: WikiMirror }
  | { ok: false; reason: WikiUnavailableReason; detail: string };

interface CacheEntry {
  fetchedAt: number;
  mirror: WikiMirror | null;
  /** Fetch in flight, so concurrent readers share one. */
  inFlight: Promise<WikiMirrorResult> | null;
}

/**
 * The cache lives on `globalThis` for the same reason the database handle does:
 * `bun run --hot` re-evaluates this module on every edit, and a module-level map
 * would be dropped while its on-disk mirrors stayed.
 */
interface WikiCacheHost {
  entries: Map<string, CacheEntry>;
}

declare global {
  // eslint-disable-next-line no-var
  var __kabmoWikiCache: WikiCacheHost | undefined;
}

function cache(): Map<string, CacheEntry> {
  globalThis.__kabmoWikiCache ??= { entries: new Map() };
  return globalThis.__kabmoWikiCache.entries;
}

/**
 * Directory for one wiki, derived from host and slug rather than from the remote
 * URL: a token in that URL would otherwise land in a path name, and two
 * spellings of the same remote (`https` and `ssh`) must share one mirror.
 */
function mirrorDir(host: string, slug: string): string {
  const safe = (value: string) => value.replace(/[^A-Za-z0-9._-]+/g, '__').replace(/^_+|_+$/g, '');
  return path.join(getDataDir(), 'wiki', `${safe(host)}__${safe(slug)}`);
}

/**
 * Git's own wording for "there is nothing here to show".
 *
 * Three shapes, all meaning the same thing to a reader: the repository does not
 * exist ("Repository not found"), it exists but is not readable without a
 * credential ("Authentication failed", "could not read Username"), or it exists
 * and is EMPTY — `couldn't find remote ref HEAD`, which is what a GitLab project
 * with a wiki that has never had a page answers (verified against
 * `git-rbi.jatismobile.com/jns6_6/drrealhandler.wiki.git`).
 */
const MISSING_WIKI_RE = /(repository not found|authentication failed|could not read username|access denied|terminal prompts disabled|invalid username or|couldn't find remote ref)/i;

function classifyFetchFailure(result: GitRun): { reason: WikiUnavailableReason; detail: string } {
  const detail = firstLine(result.stderr || result.stdout);
  if (result.failed) return { reason: 'unreachable', detail: detail || 'The wiki fetch timed out' };
  if (MISSING_WIKI_RE.test(detail)) return { reason: 'no-wiki', detail };
  return { reason: 'unreachable', detail: detail || 'The wiki could not be read' };
}

async function readRevision(repoDir: string): Promise<WikiMirror | null> {
  const out = await gitRun(['--git-dir', repoDir, 'log', '-1', '--format=%H%n%cI', REF], { timeoutMs: READ_TIMEOUT_MS });
  if (out.exitCode !== 0) return null;
  const [revision, updatedAt] = out.stdout.trim().split('\n');
  if (!revision) return null;
  return { repoDir, revision, updatedAt: updatedAt ?? '' };
}

async function fetchWiki(host: string, slug: string, remote: string): Promise<WikiMirrorResult> {
  const repoDir = mirrorDir(host, slug);
  try {
    await fs.promises.mkdir(repoDir, { recursive: true });
    // `init` only when there is nothing there: re-initialising a live mirror
    // would drop the ref the previous fetch wrote.
    if (!fs.existsSync(path.join(repoDir, 'HEAD'))) {
      const init = await gitRun(['init', '--bare', '--quiet', repoDir], { timeoutMs: READ_TIMEOUT_MS });
      if (init.exitCode !== 0) {
        return { ok: false, reason: 'unreachable', detail: firstLine(init.stderr) || 'Could not prepare the wiki cache' };
      }
    }

    const fetched = await gitRun(
      ['--git-dir', repoDir, 'fetch', '--no-write-fetch-head', '--depth', '1', '--force', '--quiet', remote, `HEAD:${REF}`],
      { timeoutMs: FETCH_TIMEOUT_MS },
    );
    if (fetched.exitCode !== 0) return { ok: false, ...classifyFetchFailure(fetched) };

    const mirror = await readRevision(repoDir);
    if (!mirror) return { ok: false, reason: 'no-wiki', detail: 'The wiki repository holds no pages' };
    return { ok: true, mirror };
  } catch (error) {
    return { ok: false, reason: 'unreachable', detail: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * The mirror for one wiki, re-fetching it when the cached one is older than the
 * TTL. Concurrent callers share a single fetch.
 */
export async function ensureWikiMirror(
  host: string,
  slug: string,
  remote: string,
  force = false,
): Promise<WikiMirrorResult> {
  const key = `${host}\u0000${slug}`;
  const entries = cache();
  const entry = entries.get(key);

  if (!force && entry?.mirror && Date.now() - entry.fetchedAt < MIRROR_TTL_MS) {
    return { ok: true, mirror: entry.mirror };
  }
  if (entry?.inFlight) return entry.inFlight;

  const inFlight = fetchWiki(host, slug, remote).then((result) => {
    const current = entries.get(key);
    if (current) {
      current.inFlight = null;
      if (result.ok) {
        current.mirror = result.mirror;
        current.fetchedAt = Date.now();
      }
    }
    return result;
  });

  entries.set(key, { fetchedAt: entry?.fetchedAt ?? 0, mirror: entry?.mirror ?? null, inFlight });
  return inFlight;
}

/**
 * Every path in the mirror's tree, verbatim (`Home.md`, `images/x.png`).
 *
 * `-z` because a wiki path is author-chosen and does hold spaces — the repo this
 * feature was built against carries
 * `Setting-up-a-OneDrive-project-to-use-with-diagrams.net.md`.
 */
export async function listWikiPaths(repoDir: string): Promise<string[]> {
  const out = await gitRun(['--git-dir', repoDir, 'ls-tree', '-r', '--name-only', '-z', REF], { timeoutMs: READ_TIMEOUT_MS });
  if (out.exitCode !== 0) return [];
  return out.stdout.split('\0').filter(Boolean);
}

export type WikiBlobResult =
  | { ok: true; text: string; truncated: boolean }
  | { ok: false; error: string };

/** One page's markdown source, cut at {@link MAX_WIKI_PAGE_CHARS}. */
export async function readWikiPage(repoDir: string, pagePath: string): Promise<WikiBlobResult> {
  const out = await gitRun(['--git-dir', repoDir, 'show', `${REF}:${pagePath}`], { timeoutMs: READ_TIMEOUT_MS });
  if (out.exitCode !== 0) return { ok: false, error: `Page not found: ${pagePath}` };
  const truncated = out.stdout.length > MAX_WIKI_PAGE_CHARS;
  return { ok: true, text: truncated ? out.stdout.slice(0, MAX_WIKI_PAGE_CHARS) : out.stdout, truncated };
}

/**
 * One asset's bytes, for a page's own `![](images/schema.png)`.
 *
 * Read as bytes rather than through the text runner: decoding stdout as UTF-8
 * turns a PNG into replacement characters. An oversized blob is refused rather
 * than returned — git cannot be asked for the size and the bytes in one spawn,
 * and the panel is a reader, not a file server.
 */
export async function readWikiAsset(repoDir: string, assetPath: string): Promise<Uint8Array | null> {
  let proc: Bun.Subprocess<'ignore', 'pipe', 'ignore'>;
  try {
    proc = Bun.spawn({
      env: childEnv(),
      cmd: ['git', '--git-dir', repoDir, 'show', `${REF}:${assetPath}`],
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'ignore',
      timeout: READ_TIMEOUT_MS,
    });
  } catch {
    return null;
  }
  const bytes = new Uint8Array(await new Response(proc.stdout).arrayBuffer());
  const exitCode = await proc.exited;
  if (exitCode !== 0 || bytes.byteLength === 0 || bytes.byteLength > MAX_WIKI_ASSET_BYTES) return null;
  return bytes;
}
