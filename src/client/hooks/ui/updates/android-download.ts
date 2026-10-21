/**
 * What the sidebar should offer for the Android shell, and why.
 *
 * Two DIFFERENT offers, from two different facts:
 *
 * - **`update`** — this page is running inside the APK (`shellVersion` from the
 *   bootstrap) and a newer one is published. An up-to-date app offers nothing:
 *   a button that downloads the build already installed is worse than no button.
 * - **`install`** — this page is an Android BROWSER (Chrome, Brave, Firefox) and
 *   an APK is published. The reader may not know a native shell exists, and
 *   telling them is the whole point of the offer; there is no installed version
 *   to compare against, so the newest published one is what it names.
 *
 * A desktop browser gets neither: `isAndroid` is false, an APK cannot be
 * installed there, and the app's own update badge already covers the server.
 *
 * The probe is lazy: it runs only on an Android device, never on a desktop, so a
 * console that can never show the button makes no request for it.
 */

import { useEffect, useState } from 'preact/hooks';
import { isNewer } from '@/shared/lib/updates/semver';

/** Which offer this is — the two carry different wording. */
export type AndroidOfferKind = 'update' | 'install';

export interface AndroidDownload {
  /** The asset to download. */
  url: string;
  /** The version that asset ships. */
  latest: string;
  /** The release page, for a "what changed" link. */
  releaseUrl: string | null;
  /** An update to an installed APK, or a first install from a browser. */
  kind: AndroidOfferKind;
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
export function parseAndroidRelease(payload: unknown): Omit<AndroidDownload, 'kind'> | null {
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
 * The offer, or null.
 *
 * `shellVersion` is null in every browser — that is what makes the two branches
 * mutually exclusive — and `isAndroid` is the wider fact that admits a browser
 * ON ANDROID. Both come from the bootstrap rather than a client-side UA sniff:
 * the server already parsed them for the very request that served the page.
 *
 * An `install` needs no version comparison, because nothing is installed. It
 * does require a published APK: `release` being null is a failed probe, and a
 * button the console cannot back with a link must not appear.
 */
export function shouldOfferAndroidDownload(
  shellVersion: string | null | undefined,
  isAndroid: boolean | null | undefined,
  release: Omit<AndroidDownload, 'kind'> | null,
): AndroidDownload | null {
  if (!release) return null;

  // Inside the APK: an update, and only when one exists.
  if (shellVersion) {
    return isNewer(release.latest, shellVersion) ? { ...release, kind: 'update' } : null;
  }

  // A browser on an Android device: the app is something to install.
  if (isAndroid) return { ...release, kind: 'install' };

  return null;
}

/**
 * The wording of the offer, in one place.
 *
 * Both layouts draw this control and they must say the same thing: an installed
 * app that is behind is an UPDATE, and a browser on Android is an INSTALL —
 * "Download" for both would leave a first-time reader unsure whether they
 * already have the app. The version is in the label because the asset is a
 * specific build, not "the app".
 */
export function androidDownloadLabel(download: AndroidDownload): string {
  const verb = download.kind === 'update' ? 'Update' : 'Install';
  return `${verb} Kabmo ${download.latest} for Android`;
}

/**
 * Fetch the published APK and decide what to offer.
 *
 * `fetchImpl` is a seam for the tests: the cases that matter (no release, a
 * failed probe, a version equal to the installed one) cannot be produced by a
 * live GitHub call.
 */
export function useAndroidDownload(
  shellVersion: string | null | undefined,
  isAndroid: boolean | null | undefined,
  fetchImpl: typeof fetch = fetch,
): AndroidDownload | null {
  const [release, setRelease] = useState<Omit<AndroidDownload, 'kind'> | null>(null);
  const wanted = Boolean(shellVersion) || Boolean(isAndroid);

  useEffect(() => {
    if (!wanted) return;

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
  }, [wanted, fetchImpl]);

  return shouldOfferAndroidDownload(shellVersion, isAndroid, release);
}
