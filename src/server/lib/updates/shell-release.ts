/**
 * Which published native-shell artifact a browser or an installed shell should
 * download, and whether the installed one is behind.
 *
 * Neither shell is an npm package (see `.github/workflows/publish-android.yml`
 * and `publish-ios.yml`), so the npm probe that answers for the app and for
 * `omp` cannot answer here. The only record of a published shell is a GitHub
 * release asset, which means one unauthenticated REST read of the release LIST —
 * not `/releases/latest`, which answers the newest release of ANY kind (see
 * `fetchShellRelease`).
 *
 * ONE module for both shells, because the question is identical and only the
 * asset naming differs. Two copies is how one of them starts reading the release
 * tag, or caching under a slot the other overwrites.
 *
 * Two facts travel back, and they answer different questions:
 *
 * - `url` is the asset to download. It is resolved from the release's OWN asset
 *   list rather than built as `releases/latest/download/<name>`, because that
 *   path needs the asset name to match exactly and the name carries the tag
 *   (`kabmo-android-v1.2.3.apk`) — a name built here would be a second copy of
 *   the workflow's naming rule, and the first release that renames it 404s.
 * - `latest` is the version that asset ships, read from the asset name. The
 *   release TAG cannot be used: the artifact is attached to the app's release,
 *   whose tag names the SERVER version, and the two move independently.
 *
 * Failure is a normal answer here (`null`), never a throw: an offline box or a
 * rate-limited GitHub must not take the sidebar down, and a button that appears
 * because a probe failed would offer a download that does not exist.
 */

import { REPO } from '@/server/lib/updates/release-url';
import type { ShellKind } from '@/shared/lib/updates/shell-ua';

/** One published shell artifact, as the console needs it. */
export interface ShellRelease {
  /** Asset download URL, or null when the release carries no artifact. */
  url: string | null;
  /** Version the asset name declares (`v1.2.3` → `1.2.3`), or null. */
  latest: string | null;
  /** The release page, for a "what changed" link. */
  releaseUrl: string | null;
}

/** How each shell's asset is named by its publish workflow. */
export const SHELL_ASSETS: Record<ShellKind, { prefix: string; extension: string }> = {
  android: { prefix: 'kabmo-android-', extension: '.apk' },
  ios: { prefix: 'kabmo-ios-', extension: '.ipa' },
};

/**
 * `kabmo-android-v1.2.3.apk` → `1.2.3` (and the `.ipa` twin).
 *
 * The `v` is optional because a hand-uploaded asset may omit it, and a version
 * that cannot be read is not evidence of an update — the caller treats null as
 * "no new version".
 */
export function versionFromAssetName(kind: ShellKind, name: string): string | null {
  const { prefix, extension } = SHELL_ASSETS[kind];
  if (!name.startsWith(prefix) || !name.endsWith(extension)) return null;
  const middle = name.slice(prefix.length, -extension.length);
  const version = middle.startsWith('v') ? middle.slice(1) : middle;
  return /^\d+\.\d+\.\d+/.test(version) ? version : null;
}

/**
 * The newest release that actually carries this shell's artifact.
 *
 * NOT `/releases/latest`, which answers the newest release of ANY kind. This
 * repository publishes three artifacts from one push, and the packages are
 * released FIRST (`packages → marketplace → android → apk-build → app` in
 * `release.yml`), so their `kabmo-sdk/v*` / `kabmo-ui/v*` releases are newer
 * than the app release that carries the shell. `@semantic-release/github` runs
 * in both pipelines, so those are real releases — measured against a stub that
 * answered a package release: `/releases/latest` produced
 * `{url: null, latest: null}` and the sidebar's button disappeared even though
 * the APK sat on the release directly below.
 *
 * One request per shell, cached for five minutes on `globalThis` for the same
 * reason the database handle is anchored there: `bun --hot` re-evaluates this
 * module while the cache it would otherwise hold lives on. GitHub allows 60
 * unauthenticated reads an hour per address, and the sidebar asks on every
 * mount.
 */
export async function fetchShellRelease(
  kind: ShellKind,
  fetchImpl: typeof fetch = fetch,
): Promise<ShellRelease | null> {
  const cache = cacheSlot(kind);
  const now = Date.now();
  if (cache.entry && now - cache.at < CACHE_MS) return cache.entry;

  try {
    const response = await fetchImpl(`${githubApiBase()}/repos/${REPO}/releases?per_page=${RELEASE_SCAN}`, {
      headers: {
        accept: 'application/vnd.github+json',
        // GitHub rejects a request with no User-Agent.
        'user-agent': 'kabmo-console',
      },
    });
    if (!response.ok) return cache.entry ?? null;

    const body = (await response.json()) as unknown;
    // A body that is not the release list is a failed probe, not an empty
    // repository: answering `{url: null, latest: null}` here would be
    // indistinguishable from "no release carries an artifact", and the caller
    // would cache that mistake for five minutes.
    if (!Array.isArray(body)) return cache.entry ?? null;

    // Drafts are not published and prereleases are not what a console offers an
    // installed shell — the same two the `latest` endpoint excluded.
    const published = body.filter(
      (entry): entry is Record<string, unknown> =>
        entry !== null && typeof entry === 'object' && entry.draft !== true && entry.prerelease !== true,
    );

    const release = published
      .map((entry) => ({ entry, asset: shellAsset(kind, entry.assets) }))
      .find((candidate) => candidate.asset !== null);

    if (!release?.asset) {
      const fallback: ShellRelease = { url: null, latest: null, releaseUrl: null };
      cache.entry = fallback;
      cache.at = now;
      return fallback;
    }

    const resolved: ShellRelease = {
      url: typeof release.asset.browser_download_url === 'string' ? release.asset.browser_download_url : null,
      latest: versionFromAssetName(kind, String(release.asset.name)),
      releaseUrl: typeof release.entry.html_url === 'string' ? release.entry.html_url : null,
    };

    cache.entry = resolved;
    cache.at = now;
    return resolved;
  } catch {
    // Keep the last good answer rather than replacing it with a failure: a
    // momentary outage must not remove a download button that was valid.
    return cache.entry ?? null;
  }
}

/** How many releases to look back through for the artifact. */
const RELEASE_SCAN = 20;

/** The first asset of a release that names this shell's artifact, or null. */
function shellAsset(kind: ShellKind, assets: unknown): Record<string, unknown> | null {
  if (!Array.isArray(assets)) return null;

  for (const entry of assets) {
    if (entry === null || typeof entry !== 'object') continue;
    const asset = entry as Record<string, unknown>;
    if (typeof asset.name === 'string' && versionFromAssetName(kind, asset.name) !== null) return asset;
  }

  return null;
}

const CACHE_MS = 5 * 60_000;

/**
 * Where the release read goes.
 *
 * Overridable for the same reason the npm probe honours `NPM_CONFIG_REGISTRY`: a
 * test and a rehearsal need to exercise the real parsing against a stub instead
 * of a live GitHub call, and hardcoding the host makes that impossible without
 * intercepting `fetch` globally.
 */
function githubApiBase(): string {
  const configured = Bun.env.KABMO_GITHUB_API ?? '';
  return configured.trim().replace(/\/+$/, '') || 'https://api.github.com';
}

interface CacheSlot {
  entry: ShellRelease | null;
  at: number;
}

type ShellCacheHost = typeof globalThis & {
  __kabmoShellRelease?: Partial<Record<ShellKind, CacheSlot>>;
};

/**
 * The cache slot for one shell.
 *
 * PER SHELL, not one shared slot: both probes read the same release list but
 * resolve different assets, so one slot would make the second shell answer with
 * the first one's artifact.
 */
function cacheSlot(kind: ShellKind): CacheSlot {
  const host = globalThis as ShellCacheHost;
  host.__kabmoShellRelease ??= {};
  host.__kabmoShellRelease[kind] ??= { entry: null, at: 0 };
  return host.__kabmoShellRelease[kind] as CacheSlot;
}

/**
 * Drop the cached answer for one shell (or every shell, with no argument).
 *
 * The cache lives on `globalThis` so `bun --hot` cannot orphan it, which also
 * means it outlives a test file: without this seam the second case in a suite
 * reads the first case's answer and passes for the wrong reason (measured — the
 * "malformed body" case returned the previous test's release). Production has
 * no caller; it exists because the cache is process-wide by design.
 */
export function resetShellReleaseCache(kind?: ShellKind): void {
  const host = globalThis as ShellCacheHost;
  if (!kind) {
    host.__kabmoShellRelease = {};
    return;
  }
  host.__kabmoShellRelease ??= {};
  host.__kabmoShellRelease[kind] = { entry: null, at: 0 };
}
