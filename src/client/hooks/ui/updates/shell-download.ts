/**
 * What the sidebar should offer for a native shell, and why.
 *
 * TWO DIFFERENT OFFERS, from two different facts:
 *
 * - **`update`** — this page is running inside the shell (`shellVersion` from
 *   the bootstrap) and a newer build is published. An up-to-date shell offers
 *   nothing: a button that downloads the build already installed is worse than
 *   no button.
 * - **`install`** — this page is an Android BROWSER (Chrome, Brave, Firefox) and
 *   an APK is published. The reader may not know a native shell exists, and
 *   telling them is the whole point of the offer; there is no installed version
 *   to compare against, so the newest published one is what it names.
 *
 * There is NO iOS install offer. An IPA cannot be installed from a page the way
 * an APK can — iOS has no sideload-by-URL path — so a browser on an iPhone is
 * offered nothing, and only an installed iOS shell ever sees this control.
 *
 * A desktop browser gets neither: an APK cannot be installed there, and the
 * app's own update badge already covers the server.
 *
 * The probe is lazy: it runs only when a shell token or an Android device is
 * present, so a console that can never show the button makes no request for it.
 * ONE hook for both shells, because the decision table is identical and only the
 * artifact, the endpoint and the platform word differ.
 */

import { useEffect, useState } from 'preact/hooks';
import { isNewer } from '@/shared/lib/updates/semver';
import type { ShellKind } from '@/shared/lib/updates/shell-ua';

/** Which shell the offer is for. */
export type ShellPlatform = ShellKind;

/** Which offer this is — the two carry different wording. */
export type ShellOfferKind = 'update' | 'install';

export interface ShellDownload {
  /** The artifact to download. */
  url: string;
  /** The version that artifact ships. */
  latest: string;
  /** The release page, for a "what changed" link. */
  releaseUrl: string | null;
  /** An update to an installed shell, or a first install from a browser. */
  kind: ShellOfferKind;
  /** Which shell this offer is for. */
  platform: ShellPlatform;
}

interface ReleasePayload {
  url?: unknown;
  latest?: unknown;
  releaseUrl?: unknown;
}

/** The platform's own name, as the label says it. */
const PLATFORM_NAMES: Record<ShellPlatform, string> = {
  android: 'Android',
  ios: 'iOS',
};

/**
 * Read the release payload defensively.
 *
 * The route answers `{url: null, latest: null, releaseUrl: null}` on a failed
 * probe, so a shape check that only looks at the version would offer a button
 * with no link.
 */
export function parseShellRelease(payload: unknown): Omit<ShellDownload, 'kind' | 'platform'> | null {
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
 * `version` is null in every browser — that is what makes the two branches
 * mutually exclusive — and `onAndroid` is the wider fact that admits a browser
 * ON ANDROID. Both come from the bootstrap rather than a client-side UA sniff:
 * the server already parsed them for the very request that served the page.
 *
 * An `install` needs no version comparison, because nothing is installed. It
 * does require a published artifact: `release` being null is a failed probe, and
 * a button the console cannot back with a link must not appear.
 */
export function shouldOfferShellDownload(
  platform: ShellPlatform,
  version: string | null | undefined,
  onAndroid: boolean | null | undefined,
  release: Omit<ShellDownload, 'kind' | 'platform'> | null,
): ShellDownload | null {
  if (!release) return null;

  // Inside the shell: an update, and only when one exists.
  if (version) {
    return isNewer(release.latest, version) ? { ...release, kind: 'update', platform } : null;
  }

  // A browser on an Android device: the app is something to install. iOS has no
  // equivalent — an IPA cannot be installed from a page — so the platform is
  // part of this test, not only the label.
  if (platform === 'android' && onAndroid) return { ...release, kind: 'install', platform };

  return null;
}

/**
 * The wording of the offer, in one place.
 *
 * Both layouts draw this control and they must say the same thing: an installed
 * shell that is behind is an UPDATE, and a browser on Android is an INSTALL —
 * "Download" for both would leave a first-time reader unsure whether they
 * already have the app. The version is in the label because the artifact is a
 * specific build, not "the app".
 */
export function shellDownloadLabel(download: ShellDownload): string {
  const verb = download.kind === 'update' ? 'Update' : 'Install';
  return `${verb} Kabmo ${download.latest} for ${PLATFORM_NAMES[download.platform]}`;
}

/** The endpoint that answers for one shell. */
export function shellReleasePath(platform: ShellPlatform): string {
  return `/api/updates/${platform}`;
}

/**
 * Which shell this page is running inside, from the bootstrap.
 *
 * The Android token wins when both are somehow present: the two shells are
 * different devices, and a UA carrying both is crafted rather than observed.
 */
export function shellFromBootstrap(bootstrap: {
  shellVersion?: string | null;
  iosShellVersion?: string | null;
} | undefined): { platform: ShellPlatform; version: string } | null {
  if (bootstrap?.shellVersion) return { platform: 'android', version: bootstrap.shellVersion };
  if (bootstrap?.iosShellVersion) return { platform: 'ios', version: bootstrap.iosShellVersion };
  return null;
}

/**
 * Fetch the published artifact and decide what to offer.
 *
 * `fetchImpl` is a seam for the tests: the cases that matter (no release, a
 * failed probe, a version equal to the installed one) cannot be produced by a
 * live GitHub call.
 */
export function useShellDownload(
  platform: ShellPlatform,
  version: string | null | undefined,
  onAndroid: boolean | null | undefined,
  fetchImpl: typeof fetch = fetch,
): ShellDownload | null {
  const [release, setRelease] = useState<Omit<ShellDownload, 'kind' | 'platform'> | null>(null);
  const wanted = Boolean(version) || (platform === 'android' && Boolean(onAndroid));

  useEffect(() => {
    if (!wanted) return;

    let cancelled = false;
    void (async () => {
      try {
        const response = await fetchImpl(shellReleasePath(platform));
        if (!response.ok) return;
        const payload: unknown = await response.json();
        if (!cancelled) setRelease(parseShellRelease(payload));
      } catch {
        // A probe that cannot answer is a button that must not appear.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [wanted, platform, fetchImpl]);

  return shouldOfferShellDownload(platform, version, onAndroid, release);
}

/**
 * The offer for whichever shell this page is running inside — or the Android
 * install offer for a browser on that platform.
 *
 * The single entry point both sidebar layouts call, so the two cannot disagree
 * about which shell they are in or which endpoint they read. It reads the
 * bootstrap the SERVER wrote for this request rather than sniffing the UA
 * client-side, because the server already parsed it for the very response that
 * carried the page.
 */
export function useShellOffer(fetchImpl: typeof fetch = fetch): ShellDownload | null {
  const bootstrap = typeof window === 'undefined' ? undefined : window.__OMP_BOOTSTRAP__;
  const shell = shellFromBootstrap(bootstrap);
  return useShellDownload(
    shell?.platform ?? 'android',
    shell?.version ?? null,
    bootstrap?.isAndroid,
    fetchImpl,
  );
}

/**
 * The short form the phone's footer prints, where the label has no room.
 *
 * It names the OFFER, and for Android it names the file type because that is
 * what a reader recognises (`APK` is the thing they will see in Downloads). An
 * iOS update is an IPA, which nobody installs by hand — the shell finishes the
 * install itself — so the platform word is the honest one there.
 */
export function shellDownloadShortLabel(download: ShellDownload): string {
  if (download.platform === 'ios') return 'Update app';
  return download.kind === 'update' ? 'Update APK' : 'Get APK';
}
