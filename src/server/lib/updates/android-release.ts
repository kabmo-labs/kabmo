/**
 * Which Android APK a browser should download, and whether this one is behind.
 *
 * The APK is NOT an npm package (see `.github/workflows/publish-android.yml`), so
 * the npm probe that answers for the app and for `omp` cannot answer here. The
 * only record of a published APK is the GitHub release asset, which means one
 * unauthenticated REST read of the newest release.
 *
 * Two facts travel back, and they answer different questions:
 *
 * - `url` is the asset to download. It is resolved from the release's OWN asset
 *   list rather than built as `releases/latest/download/<name>`, because that
 *   path needs the asset name to match exactly and the name carries the tag
 *   (`kabmo-android-v1.2.3.apk`) — a name built here would be a second copy of
 *   the workflow's naming rule, and the first release that renames it 404s.
 * - `latest` is the version that asset ships, read from the asset name. The
 *   release TAG cannot be used: the APK is attached to the app's release, whose
 *   tag names the SERVER version, and the two move independently.
 *
 * Failure is a normal answer here (`null`), never a throw: an offline box or a
 * rate-limited GitHub must not take the sidebar down, and a button that appears
 * because a probe failed would offer a download that does not exist.
 */

import { REPO } from '@/server/lib/updates/release-url';

/** One published APK, as the console needs it. */
export interface AndroidRelease {
  /** Asset download URL, or null when the release carries no APK. */
  url: string | null;
  /** Version the asset name declares (`v1.2.3` → `1.2.3`), or null. */
  latest: string | null;
  /** The release page, for a "what changed" link. */
  releaseUrl: string | null;
}

/** The asset-name prefix the release workflow writes. */
const ASSET_PREFIX = 'kabmo-android-';

/**
 * `kabmo-android-v1.2.3.apk` → `1.2.3`.
 *
 * The `v` is optional because a hand-uploaded asset may omit it, and a version
 * that cannot be read is not evidence of an update — the caller treats null as
 * "no new version".
 */
export function versionFromAssetName(name: string): string | null {
  if (!name.startsWith(ASSET_PREFIX) || !name.endsWith('.apk')) return null;
  const middle = name.slice(ASSET_PREFIX.length, -'.apk'.length);
  const version = middle.startsWith('v') ? middle.slice(1) : middle;
  return /^\d+\.\d+\.\d+/.test(version) ? version : null;
}

/**
 * The newest release's APK.
 *
 * One request, cached for five minutes on `globalThis` for the same reason the
 * database handle is anchored there: `bun --hot` re-evaluates this module while
 * the cache it would otherwise hold lives on. GitHub allows 60 unauthenticated
 * reads an hour per address, and the sidebar asks on every mount.
 */
export async function fetchAndroidRelease(fetchImpl: typeof fetch = fetch): Promise<AndroidRelease | null> {
  const cache = cacheSlot();
  const now = Date.now();
  if (cache.entry && now - cache.at < CACHE_MS) return cache.entry;

  try {
    const response = await fetchImpl(`${githubApiBase()}/repos/${REPO}/releases/latest`, {
      headers: {
        accept: 'application/vnd.github+json',
        // GitHub rejects a request with no User-Agent.
        'user-agent': 'kabmo-console',
      },
    });
    if (!response.ok) return cache.entry ?? null;

    const body = (await response.json()) as {
      html_url?: unknown;
      assets?: unknown;
    };
    // A body that is not the release document is a failed probe, not an empty
    // release: answering `{url: null, latest: null}` here would be
    // indistinguishable from "a release with no APK", and the caller would cache
    // that mistake for five minutes.
    if (!Array.isArray(body.assets)) return cache.entry ?? null;

    const assets = body.assets;
    const asset = assets
      .map((entry) => (entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : null))
      .find((entry) => entry && typeof entry.name === 'string' && versionFromAssetName(entry.name) !== null);

    const name = typeof asset?.name === 'string' ? asset.name : '';
    const url = typeof asset?.browser_download_url === 'string' ? asset.browser_download_url : null;
    const release: AndroidRelease = {
      url,
      latest: versionFromAssetName(name),
      releaseUrl: typeof body.html_url === 'string' ? body.html_url : null,
    };

    cache.entry = release;
    cache.at = now;
    return release;
  } catch {
    // Keep the last good answer rather than replacing it with a failure: a
    // momentary outage must not remove a download button that was valid.
    return cache.entry ?? null;
  }
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
  entry: AndroidRelease | null;
  at: number;
}

function cacheSlot(): CacheSlot {
  const host = globalThis as typeof globalThis & { __kabmoAndroidRelease?: CacheSlot };
  host.__kabmoAndroidRelease ??= { entry: null, at: 0 };
  return host.__kabmoAndroidRelease;
}

/**
 * Drop the cached answer.
 *
 * The cache lives on `globalThis` so `bun --hot` cannot orphan it, which also
 * means it outlives a test file: without this seam the second case in a suite
 * reads the first case's answer and passes for the wrong reason (measured — the
 * "malformed body" case returned the previous test's release). Production has no
 * caller; it exists because the cache is process-wide by design.
 */
export function resetAndroidReleaseCache(): void {
  cacheSlot().entry = null;
  cacheSlot().at = 0;
}
