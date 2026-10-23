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
 *   path needs the asset name to match exactly and the name carries the shell's
 *   version (`Kabmo-0.5.0-android.apk`) — a name built here would be a second
 *   copy of the workflow's naming rule, and the first release that renames it
 *   404s.
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

/**
 * How each shell's asset is named by its publish workflow, plus the prefix it
 * carried BEFORE the rename.
 *
 * ONE scheme for every shell in the project — `<App>-<version>-<platform>.<ext>`:
 * `Kabmo-0.5.0-android.apk`, `Kabmo-0.1.0-ios.ipa`, and the desktop trio's
 * `Kabmo-0.1.2-mac-arm64.dmg` / `-win-x64-setup.exe` / `-linux-x86_64.tar.gz`.
 * The mobile pair carries no architecture because neither artifact is per-arch:
 * the APK is one universal build (the shell is pure Kotlin with no native
 * libraries, so there is nothing to split), and the IPA contains only the device
 * slice (`arm64-apple-ios`). A `-arm64` in those names would claim a distinction
 * that does not exist and would make the parser look for a second artifact.
 *
 * **`legacyPrefix` is not dead code.** These names are PARSED to answer "is a
 * newer shell published", and every release already on GitHub carries the old
 * spelling. Dropping it would make the console answer "no update" for an
 * installed shell the moment this ships — silently, because a name that does not
 * match reads exactly like a release with no artifact. The probe tries the
 * current prefix first, then the old one; new releases only ever write the
 * current one.
 */
export const SHELL_ASSETS: Record<
  ShellKind,
  { prefix: string; extension: string; legacyPrefix: string; legacyExtension: string }
> = {
  android: {
    prefix: 'Kabmo-',
    extension: '-android.apk',
    legacyPrefix: 'kabmo-android-v',
    legacyExtension: '.apk',
  },
  ios: { prefix: 'Kabmo-', extension: '-ios.ipa', legacyPrefix: 'kabmo-ios-v', legacyExtension: '.ipa' },
};

/**
 * `Kabmo-0.5.0-android.apk` → `0.5.0` (and the `.ipa` twin), plus the legacy
 * `kabmo-android-v0.5.0.apk` spelling every published release still carries.
 *
 * The version is the MIDDLE of the name in the current scheme and the TAIL of the
 * legacy one, so the two are parsed by different rules rather than by one that
 * tries to cover both.
 */
export function versionFromAssetName(kind: ShellKind, name: string): string | null {
  const { prefix, extension, legacyPrefix, legacyExtension } = SHELL_ASSETS[kind];

  // Current: `<prefix><version><extension>`, where the prefix is the app's name
  // and the extension names the platform.
  if (name.startsWith(prefix) && name.endsWith(extension)) {
    const middle = name.slice(prefix.length, -extension.length);
    if (/^\d+\.\d+\.\d+$/.test(middle)) return middle;
  }

  // Legacy: `kabmo-android-v<version>.apk`. Kept for the releases already
  // published; no new release writes it.
  if (name.startsWith(legacyPrefix) && name.endsWith(legacyExtension)) {
    const middle = name.slice(legacyPrefix.length, -legacyExtension.length);
    const version = middle.startsWith('v') ? middle.slice(1) : middle;
    return /^\d+\.\d+\.\d+$/.test(version) ? version : null;
  }

  return null;
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
 *
 * Both schemes are still ACCEPTED (a release with only the old spelling must
 * keep working), so the preference is a second pass rather than a filter.
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

  const { prefix, extension } = SHELL_ASSETS[kind];
  return (
    named.find((asset) => {
      const name = String(asset.name);
      return name.startsWith(prefix) && name.endsWith(extension);
    }) ??
    named[0] ??
    null
  );
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
