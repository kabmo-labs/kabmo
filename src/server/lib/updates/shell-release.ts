/**
 * @license
 * SPDX-License-Identifier: MIT
 */

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
 *   trio it is the artifact when the caller reported its ARCHITECTURE, and the
 *   release page otherwise: every desktop artifact is per-architecture, and a
 *   console served to another machine cannot guess. Naming the wrong arch's file
 *   would hand half the readers a build that will not launch.
 * - `direct` says which of the two `url` is, so the client knows whether the
 *   offer can be installed from inside the shell.
 * - `latest` is the version that asset ships, read from the asset NAME (see
 *   `shell-assets`). The release TAG cannot be used: the artifact is attached to
 *   the app's release, whose tag names the SERVER version.
 *
 * Failure is a normal answer here (`null`), never a throw: an offline box must
 * not take the sidebar down, and a button that appears because a probe failed
 * would offer a download that does not exist.
 */

import { REPO } from '@/server/lib/updates/release-url';
import {
  cacheSlot,
  CACHE_MS,
  githubApiBase,
  gitHubHeaders,
  shellCacheKey,
} from '@/server/lib/updates/shell-cache';
import { SHELL_ASSETS, selfUpdateArtifact, versionFromAssetName } from '@/server/lib/updates/shell-assets';
import { findAssetInPages } from '@/server/lib/updates/shell-pages';
import type { ShellArch } from '@/shared/lib/updates/shell-arch';
import type { ShellKind } from '@/shared/lib/updates/shell-ua';

/**
 * The test seam for the process-wide answer cache, re-exported here because this
 * module is what owns the answers. The cache itself lives next door (`shell-cache`)
 * so its key — shell AND architecture — is stated in one place.
 */
export { resetShellReleaseCache } from '@/server/lib/updates/shell-cache';

/** One published shell artifact, as the console needs it. */
export interface ShellRelease {
  /** Asset download URL, or the release page for a per-arch desktop build. */
  url: string | null;
  /** Version the asset name declares (`Kabmo-1.2.3-android.apk` → `1.2.3`). */
  latest: string | null;
  /** The release page, for a "what changed" link. */
  releaseUrl: string | null;
  /**
   * True when `url` names the artifact itself rather than the release page.
   *
   * This is what tells the console whether the offer can be INSTALLED from
   * inside the shell. It is true for the mobile pair (one file for every
   * device) and for a desktop shell that reported its architecture — and false
   * for a desktop probe without one, which still gets the page that lists every
   * architecture.
   */
  direct: boolean;
}

/** The answer a probe gives when it found nothing: a valid result, not an error. */
const EMPTY_RELEASE: ShellRelease = { url: null, latest: null, releaseUrl: null, direct: false };

/**
 * The newest release that actually carries this shell's artifact.
 *
 * NOT `/releases/latest`, which answers the newest release of ANY kind. This
 * repository publishes several artifacts from one push, and the packages are
 * released FIRST (`packages → marketplace → android → … → app` in
 * `release.yml`), so their `kabmo-sdk/v*` / `kabmo-ui/v*` releases are newer
 * than the app release that carries the shells. `@semantic-release/github` runs
 * in both pipelines, so those are real releases — measured against a stub that
 * answered a package release: `/releases/latest` produced `{url: null, …}` and
 * the sidebar's button disappeared even though the APK sat on the release
 * directly below.
 *
 * `arch` is what a DESKTOP shell reports about its own machine, and it is the
 * difference between "here is the page, pick your build" and "here is your
 * installer". It is the THIRD parameter so every existing caller — including
 * every test, which passes `fetchImpl` — keeps its shape.
 *
 * Cached for five minutes on `globalThis` (see `shell-cache`) for the same
 * reason the database handle is anchored there: `bun --hot` re-evaluates this
 * module while the cache it would otherwise hold lives on.
 */
export async function fetchShellRelease(
  kind: ShellKind,
  fetchImpl: typeof fetch = fetch,
  arch: ShellArch | null = null,
): Promise<ShellRelease | null> {
  const cache = cacheSlot<ShellRelease>(shellCacheKey(kind, arch));
  const now = Date.now();
  if (cache.entry && now - cache.at < CACHE_MS) return cache.entry;

  const headers = gitHubHeaders();
  const resolved =
    (await readFromApi(kind, arch, fetchImpl, headers)) ??
    (await readFromPages(kind, arch, fetchImpl, headers));
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
  arch: ShellArch | null,
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
    // repository: answering `{url: null, …}` here would be indistinguishable
    // from "no release carries an artifact".
    if (!Array.isArray(body)) return null;

    // Drafts are not published and prereleases are not what a console offers an
    // installed shell.
    const published = body.filter(
      (entry): entry is Record<string, unknown> =>
        entry !== null && typeof entry === 'object' && entry.draft !== true && entry.prerelease !== true,
    );

    const release = published
      .map((entry) => ({ entry, asset: shellAsset(kind, arch, entry.assets) }))
      .find((candidate) => candidate.asset !== null);

    if (!release?.asset) return EMPTY_RELEASE;

    return resolvedRelease(kind, arch, {
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
  arch: ShellArch | null,
  fetchImpl: typeof fetch,
  headers: Record<string, string>,
): Promise<ShellRelease | null> {
  try {
    const found = await findAssetInPages(kind, fetchImpl, headers, arch);
    if (found.kind === 'unreachable') return null;
    if (found.kind === 'none') return EMPTY_RELEASE;
    return resolvedRelease(kind, arch, { ...found.asset, releaseUrl: found.releaseUrl });
  } catch {
    return null;
  }
}

/**
 * The asset of a release that names this shell's artifact, or null.
 *
 * Two questions, in this order:
 *
 * 1. **Does an architecture match?** When the caller named one, the only
 *    acceptable asset is the file that machine installs (`selfUpdateArtifact`).
 *    Everything else in the release — the other architecture, the `.dmg`, a
 *    `.deb` — is skipped, and the next release is tried.
 * 2. **Which spelling?** The CURRENT scheme wins over the legacy one, and that
 *    is not cosmetic. A release that carries both — which happens the moment a
 *    rename lands and `--clobber` has not yet replaced the old asset, or a
 *    hand-upload adds one beside the other — would otherwise resolve to
 *    whichever the asset list happened to order first. Measured: a release
 *    holding both `kabmo-android-v0.4.0.apk` and `Kabmo-0.6.0-android.apk`
 *    answered `0.4.0`, i.e. the console offered an update to a version it
 *    already had and hid the newer one.
 */
function shellAsset(
  kind: ShellKind,
  arch: ShellArch | null,
  assets: unknown,
): Record<string, unknown> | null {
  if (!Array.isArray(assets)) return null;

  const named = assets.filter(
    (entry): entry is Record<string, unknown> =>
      entry !== null &&
      typeof entry === 'object' &&
      typeof (entry as Record<string, unknown>).name === 'string' &&
      versionFromAssetName(kind, String((entry as Record<string, unknown>).name)) !== null,
  );

  if (arch) {
    const exact = named.find(
      (asset) => selfUpdateArtifact(kind, arch, String(asset.name)) !== null,
    );
    if (exact) return exact;
  }

  return named.find((asset) => SHELL_ASSETS[kind].current.test(String(asset.name))) ?? named[0] ?? null;
}

/**
 * Turn one resolved asset into the payload.
 *
 * `direct` is derived from the SAME decision that chose the asset: an arch was
 * named and the asset is that arch's self-update file. Deriving it separately —
 * from `directDownload`, or from the platform — is how the client ends up
 * offering an install for a release page.
 */
function resolvedRelease(
  kind: ShellKind,
  arch: ShellArch | null,
  asset: { name: string; downloadUrl: string | null; releaseUrl: string | null },
): ShellRelease {
  const installable = arch !== null && selfUpdateArtifact(kind, arch, asset.name) !== null;
  const direct = SHELL_ASSETS[kind].directDownload || installable;

  return {
    // A per-arch desktop build cannot be named without an architecture — see
    // the module comment — so the link is the page that lists every one.
    url: direct ? asset.downloadUrl : asset.releaseUrl,
    latest: versionFromAssetName(kind, asset.name),
    releaseUrl: asset.releaseUrl,
    direct: direct && asset.downloadUrl !== null,
  };
}
