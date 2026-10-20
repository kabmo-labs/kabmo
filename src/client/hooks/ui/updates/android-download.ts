/**
 * Whether the sidebar should offer an APK download.
 *
 * Two independent facts, and the button needs both:
 *
 * - **Running inside the Android app** (`shellVersion`, read from the bootstrap).
 *   In a browser there is no app to update, and a "Download APK" button there
 *   would be a second, unrelated offer sitting next to the app's own update
 *   badge.
 * - **A newer APK than the one running it** (`latest` > `shellVersion`). The
 *   published asset is attached to the app's release, so it moves on its own
 *   schedule; an up-to-date app must show nothing at all rather than a button
 *   that downloads the build already installed.
 *
 * The probe is lazy: it is fetched once when a shell is detected, never in a
 * browser, so a desktop console makes no request it cannot use.
 */

import { useEffect, useState } from 'preact/hooks';
import { isNewer } from '@/shared/lib/updates/semver';

export interface AndroidDownload {
  /** The asset to download, or null when there is nothing to offer. */
  url: string;
  /** The version that asset ships. */
  latest: string;
  /** The release page, for a "what changed" link. */
  releaseUrl: string | null;
}

interface ReleasePayload {
  url?: unknown;
  latest?: unknown;
  releaseUrl?: unknown;
}

/**
 * Read the release payload defensively.
 *
 * The route answers `{url: null, latest: null, releaseUrl: null}` on a failed
 * probe, so a shape check that only looks at the version would offer a button
 * with no link.
 */
export function parseAndroidRelease(payload: unknown): AndroidDownload | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const body = payload as ReleasePayload;
  if (typeof body.url !== 'string' || !body.url) return null;
  if (typeof body.latest !== 'string' || !body.latest) return null;
  return {
    url: body.url,
    latest: body.latest,
    releaseUrl: typeof body.releaseUrl === 'string' ? body.releaseUrl : null,
  };
}

/**
 * The download to offer, or null.
 *
 * `shellVersion` is null in a browser — that is the whole gate, and it is why
 * this takes the bootstrap value rather than sniffing the UA again on the
 * client: the server already parsed it for the very request that served the
 * page.
 */
export function shouldOfferAndroidDownload(
  shellVersion: string | null | undefined,
  release: AndroidDownload | null,
): AndroidDownload | null {
  if (!shellVersion || !release) return null;
  return isNewer(release.latest, shellVersion) ? release : null;
}

/**
 * Fetch the published APK and compare it with the running shell.
 *
 * `fetchImpl` is a seam for the tests: the cases that matter (no release, a
 * failed probe, a version equal to the installed one) cannot be produced by a
 * live GitHub call.
 */
export function useAndroidDownload(
  shellVersion: string | null | undefined,
  fetchImpl: typeof fetch = fetch,
): AndroidDownload | null {
  const [release, setRelease] = useState<AndroidDownload | null>(null);

  useEffect(() => {
    if (!shellVersion) return;

    let cancelled = false;
    void (async () => {
      try {
        const response = await fetchImpl('/api/updates/android');
        if (!response.ok) return;
        const payload: unknown = await response.json();
        if (!cancelled) setRelease(parseAndroidRelease(payload));
      } catch {
        // A probe that cannot answer is a button that must not appear.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [shellVersion, fetchImpl]);

  return shouldOfferAndroidDownload(shellVersion, release);
}
