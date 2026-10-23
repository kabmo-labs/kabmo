/**
 * Which published native-shell artifact a browser or an installed shell should
 * download, and whether the installed one is behind.
 *
 * No shell is an npm package (see `.github/workflows/publish-{android,ios,macos,
 * windows,linux}.yml`), so the npm probe that answers for the app and for `omp`
 * cannot answer here. The only record of a published shell is a GitHub release
 * asset.
 *
 * ## Two reads, because one of them has a quota
 *
 * The REST API is the precise read and the FIRST one tried. It is also
 * unauthenticated at 60 requests an hour **per source IP**, and a phone on mobile
 * data shares that IP with an entire carrier NAT — so `shell-pages` is the second
 * path, and it is why the button appears at all on a bad day. See that module's
 * own comment for the measured failure.
 *
 * ## What travels back
 *
 * - `url` is what to download. For the mobile pair it is the artifact itself (an
 *   APK the shell installs, an IPA the release page explains). For the DESKTOP
 *   trio it is the RELEASE PAGE, deliberately: every desktop artifact is
 *   per-architecture (`Kabmo-0.2.0-mac-arm64.zip`), and this server cannot know
 *   which architecture the window asking is running on — it may be a remote
 *   console on another machine entirely. Naming one arch's file would hand half
 *   the readers a build that will not launch.
 * - `latest` is the version that asset ships, read from the asset NAME (see
 *   `shell-assets`). The release TAG cannot be used: the artifact is attached to
 *   the app's release, whose tag names the SERVER version.
 *
 * Failure is a normal answer here (`null`), never a throw: an offline box must
 * not take the sidebar down, and a button that appears because a probe failed
 * would offer a download that does not exist.
 */

import { REPO } from '@/server/lib/updates/release-url';
import { SHELL_ASSETS, versionFromAssetName } from '@/server/lib/updates/shell-assets';
import { findAssetInPages } from '@/server/lib/updates/shell-pages';
import type { ShellKind } from '@/shared/lib/updates/shell-ua';

/** One published shell artifact, as the console needs it. */
export interface ShellRelease {
  /** Asset download URL, or the release page for a per-arch desktop build. */
  url: string | null;
  /** Version the asset name declares (`Kabmo-1.2.3-android.apk` → `1.2.3`). */
  latest: string | null;
  /** The release page, for a "what changed" link. */
  releaseUrl: string | null;
}

/**
 * The newest release that actually carries this shell's artifact.
 *
 * NOT `/releases/latest`, which answers the newest release of ANY kind. This
 * repository publishes several artifacts from one push, and the packages are
 * released FIRST (`packages → marketplace → android → … → app` in
 * `release.yml`), so their `kabmo-sdk/v*` / `kabmo-ui/v*` releases are newer
 * than the app release that carries the shells. `@semantic-release/github` runs
 * in both pipelines, so those are real releases — measured against a stub that
 * answered a package release: `/releases/latest` produced
 * `{url: null, latest: null}` and the sidebar's button disappeared even though
 * the APK sat on the release directly below.
 *
 * Cached for five minutes on `globalThis` for the same reason the database
 * handle is anchored there: `bun --hot` re-evaluates this module while the cache
 * it would otherwise hold lives on.
 */
export async function fetchShellRelease(
  kind: ShellKind,
  fetchImpl: typeof fetch = fetch,
): Promise<ShellRelease | null> {
  const cache = cacheSlot(kind);
  const now = Date.now();
  if (cache.entry && now - cache.at < CACHE_MS) return cache.entry;

  const headers = gitHubHeaders();
  const resolved =
    (await readFromApi(kind, fetchImpl, headers)) ?? (await readFromPages(kind, fetchImpl, headers));
  if (!resolved) return cache.entry ?? null;

  cache.entry = resolved;
  cache.at = now;
  return resolved;
}

/** How many releases to look back through for the artifact. */
const RELEASE_SCAN = 20;

/**
 * The REST read, or null when it did not answer with a usable release list.
 *
 * A non-2xx is not an error to report — it is the quota, and the caller has a
 * second path.
 */
async function readFromApi(
  kind: ShellKind,
  fetchImpl: typeof fetch,
  headers: Record<string, string>,
): Promise<ShellRelease | null> {
  try {
    const response = await fetchImpl(`${githubApiBase()}/repos/${REPO}/releases?per_page=${RELEASE_SCAN}`, {
      headers: { accept: 'application/vnd.github+json', ...headers },
    });
    if (!response.ok) return null;

    const body = (await response.json()) as unknown;
    // A body that is not the release list is a failed probe, not an empty
    // repository: answering `{url: null, latest: null}` here would be
    // indistinguishable from "no release carries an artifact".
    if (!Array.isArray(body)) return null;

    // Drafts are not published and prereleases are not what a console offers an
    // installed shell.
    const published = body.filter(
      (entry): entry is Record<string, unknown> =>
        entry !== null && typeof entry === 'object' && entry.draft !== true && entry.prerelease !== true,
    );

    const release = published
      .map((entry) => ({ entry, asset: shellAsset(kind, entry.assets) }))
      .find((candidate) => candidate.asset !== null);

    if (!release?.asset) return { url: null, latest: null, releaseUrl: null };

    return resolvedRelease(kind, {
      name: String(release.asset.name),
      downloadUrl:
        typeof release.asset.browser_download_url === 'string' ? release.asset.browser_download_url : null,
      releaseUrl: typeof release.entry.html_url === 'string' ? release.entry.html_url : null,
    });
  } catch {
    return null;
  }
}

/** The public-pages read, wrapped so a failure is the caller's `null`. */
async function readFromPages(
  kind: ShellKind,
  fetchImpl: typeof fetch,
  headers: Record<string, string>,
): Promise<ShellRelease | null> {
  try {
    const found = await findAssetInPages(kind, fetchImpl, headers);
    if (found.kind === 'unreachable') return null;
    if (found.kind === 'none') return { url: null, latest: null, releaseUrl: null };
    return resolvedRelease(kind, { ...found.asset, releaseUrl: found.releaseUrl });
  } catch {
    return null;
  }
}

/**
 * The asset of a release that names this shell's artifact, or null.
 *
 * The CURRENT scheme wins over the legacy one, and that is not cosmetic. A
 * release that carries both — which happens the moment a rename lands and
 * `--clobber` has not yet replaced the old asset, or a hand-upload adds one
 * beside the other — would otherwise resolve to whichever the asset list
 * happened to order first. Measured: a release holding both
 * `kabmo-android-v0.4.0.apk` and `Kabmo-0.6.0-android.apk` answered `0.4.0`,
 * i.e. the console offered an update to a version it already had and hid the
 * newer one.
 */
function shellAsset(kind: ShellKind, assets: unknown): Record<string, unknown> | null {
  if (!Array.isArray(assets)) return null;

  const named = assets.filter(
    (entry): entry is Record<string, unknown> =>
      entry !== null &&
      typeof entry === 'object' &&
      typeof (entry as Record<string, unknown>).name === 'string' &&
      versionFromAssetName(kind, String((entry as Record<string, unknown>).name)) !== null,
  );

  return named.find((asset) => SHELL_ASSETS[kind].current.test(String(asset.name))) ?? named[0] ?? null;
}

/** Turn one resolved asset into the payload, applying the per-kind link rule. */
function resolvedRelease(
  kind: ShellKind,
  asset: { name: string; downloadUrl: string | null; releaseUrl: string | null },
): ShellRelease {
  return {
    // A per-arch desktop build cannot be named from here — see the module
    // comment — so the link is the page that lists every architecture.
    url: SHELL_ASSETS[kind].directDownload ? asset.downloadUrl : asset.releaseUrl,
    latest: versionFromAssetName(kind, asset.name),
    releaseUrl: asset.releaseUrl,
  };
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

/**
 * A token, when the operator has one, which lifts the API quota from 60 an hour
 * to 5000 — the difference between the precise read working on a shared address
 * and falling through to the pages every time.
 *
 * Read from the environment rather than a setting: it is a deployment fact, it
 * must never reach the browser, and `kabmo serve` already passes its own
 * environment through.
 */
function gitHubHeaders(): Record<string, string> {
  const token = (Bun.env.KABMO_GITHUB_TOKEN ?? Bun.env.GITHUB_TOKEN ?? '').trim();
  const headers: Record<string, string> = {
    // GitHub rejects a request with no User-Agent.
    'user-agent': 'kabmo-console',
  };
  if (token) headers.authorization = `Bearer ${token}`;
  return headers;
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
