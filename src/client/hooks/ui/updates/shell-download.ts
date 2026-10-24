/**
 * What the console should offer for a native shell, and why.
 *
 * TWO DIFFERENT OFFERS, from two different facts:
 *
 * - **`update`** — this page is running inside the shell and a newer build is
 *   published. An up-to-date shell offers nothing: a button that downloads the
 *   build already installed is worse than no button.
 * - **`install`** — this page is an Android BROWSER (Chrome, Brave, Firefox) and
 *   an APK is published. The reader may not know a native shell exists, and
 *   telling them is the whole point of the offer; there is no installed version
 *   to compare against, so the newest published one is what it names.
 *
 * There is NO iOS install offer. An IPA cannot be installed from a page the way
 * an APK can — iOS has no sideload-by-URL path — so a browser on an iPhone is
 * offered nothing, and only an installed iOS shell ever sees this control.
 *
 * There is NO desktop BROWSER offer either, but there IS a desktop SHELL one: a
 * desktop app is installed by hand from the release page, so nothing in a tab
 * should advertise it — while an installed app that is behind has exactly the
 * same problem the mobile pair had, and used to have no way to learn it.
 *
 * The probe is lazy: it runs only when an installed shell (a bootstrap token, or
 * a bridge identity) or an Android device is present, so a console that can
 * never show the button makes no request for it. ONE hook for every shell,
 * because the decision table is identical and only the artifact, the endpoint
 * and the platform word differ.
 */

import { useEffect, useState } from 'preact/hooks';
import { isNewer } from '@/shared/lib/updates/semver';
import { parseShellArch, type ShellArch } from '@/shared/lib/updates/shell-arch';
import {
  isDesktopShellKind,
  type DesktopShellKind,
  type ShellKind,
} from '@/shared/lib/updates/shell-ua';

/** Which shell the offer is for. */
export type ShellPlatform = ShellKind;

/** Which offer this is — the two carry different wording. */
export type ShellOfferKind = 'update' | 'install';

export interface ShellDownload {
  /**
   * What the control points at.
   *
   * The artifact itself for the mobile pair (an APK the shell installs, an IPA
   * the release page explains), and for a desktop shell EITHER its own
   * per-architecture artifact (when it reported `arch`) or the RELEASE PAGE (when
   * it did not). `direct` says which, and that is what decides between a button
   * and a link.
   */
  url: string;
  /** The version that artifact ships. */
  latest: string;
  /** The release page, for a "what changed" link. */
  releaseUrl: string | null;
  /** An update to an installed shell, or a first install from a browser. */
  kind: ShellOfferKind;
  /** Which shell this offer is for. */
  platform: ShellPlatform;
  /**
   * True when `url` is the artifact itself, so the SHELL can install it.
   *
   * False means `url` is the release page: the console cannot name one file
   * (a desktop shell that did not report its architecture), so the offer is a
   * link a human follows. That distinction is what decides between an `<a>` and
   * a button that drives `update_apply`.
   */
  direct: boolean;
}

interface ReleasePayload {
  url?: unknown;
  latest?: unknown;
  releaseUrl?: unknown;
  direct?: unknown;
}

/** The platform's own name, as the label says it. */
const PLATFORM_NAMES: Record<ShellPlatform, string> = {
  android: 'Android',
  ios: 'iOS',
  macos: 'macOS',
  windows: 'Windows',
  linux: 'Linux',
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
    // Absent means "not installable": a shell that cannot install the bytes must
    // fall back to the link rather than to a button that would download into
    // nowhere.
    direct: body.direct === true,
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

/**
 * The endpoint that answers for one shell.
 *
 * The desktop trio shares ONE route with an explicit `kind`, so no absence can
 * silently mean a platform — the reason the mobile pair has two.
 */
export function shellReleasePath(platform: ShellPlatform, arch: ShellArch | null = null): string {
  if (isDesktopShellKind(platform)) {
    // The arch is what makes the answer a FILE rather than a page. A shell that
    // did not report one still asks, and still gets the page that lists every
    // architecture — the offer is then a link, which is the honest fallback.
    const base = `/api/updates/desktop?kind=${platform}`;
    return arch ? `${base}&arch=${arch}` : base;
  }
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
 * Which DESKTOP shell this page is running inside, from the bridge identity.
 *
 * The desktop trio reports itself over `window.__kabmoDesktop` rather than the
 * User-Agent, because a desktop app is not downloaded from the console and the
 * server has nothing to parse per request. The identity is injected at document
 * start, before the page's own scripts, so this answers on the FIRST paint.
 *
 * An identity whose `platform` is not one of the three is not a desktop shell
 * this build knows how to update — a newer shell reporting a fourth platform
 * must not be compared against an artifact nobody publishes.
 */
export function desktopShellFromIdentity(identity: {
  platform?: string;
  shellVersion?: string;
  arch?: string;
} | null | undefined): { platform: DesktopShellKind; version: string; arch: ShellArch | null } | null {
  if (!identity?.platform || !identity.shellVersion) return null;
  if (!isDesktopShellKind(identity.platform)) return null;
  return {
    platform: identity.platform,
    version: identity.shellVersion,
    // A shell too old to report one keeps working: the offer degrades to the
    // release page instead of disappearing.
    arch: parseShellArch(identity.arch),
  };
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
  arch: ShellArch | null = null,
): ShellDownload | null {
  /**
   * The answer, TAGGED with the platform it was read for.
   *
   * A bare payload is not enough: this hook is called with a different platform
   * when a page's shell changes (a desktop identity arriving, a spawn adoption),
   * and an untagged answer would be compared against the new platform's version
   * — offering an Android APK to a Mac for one render.
   */
  const [answer, setAnswer] = useState<{
    key: string;
    release: Omit<ShellDownload, 'kind' | 'platform'> | null;
  } | null>(null);
  const wanted = Boolean(version) || (platform === 'android' && Boolean(onAndroid));
  // The question this hook is asking, arch included: two windows on one console
  // differ only by architecture, and an answer read for the other one is not an
  // answer.
  const key = `${platform}:${arch ?? ''}`;

  useEffect(() => {
    if (!wanted) return;

    let cancelled = false;
    void (async () => {
      try {
        const response = await fetchImpl(shellReleasePath(platform, arch));
        if (!response.ok) return;
        const payload: unknown = await response.json();
        if (!cancelled) setAnswer({ key, release: parseShellRelease(payload) });
      } catch {
        // A probe that cannot answer is a button that must not appear.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [wanted, key, platform, arch, fetchImpl]);

  // A stale answer belongs to the question it was read for, not this one.
  const release = answer?.key === key ? answer.release : null;
  return shouldOfferShellDownload(platform, version, onAndroid, release);
}

/** The bridge identity a desktop shell injects before the page's first script. */
export interface DesktopIdentity {
  platform?: string;
  shellVersion?: string;
}

function readDesktopIdentity(): DesktopIdentity | null {
  if (typeof window === 'undefined') return null;
  // `window.__kabmoDesktop` is declared by `lib/desktop/bridge` — the same
  // object the shell injects, so this reads the shell's own contract rather
  // than re-declaring its shape here.
  return window.__kabmoDesktop ?? null;
}

/**
 * The offer for whichever shell this page is running inside — or the Android
 * install offer for a browser on that platform.
 *
 * The single entry point both sidebar layouts call, so the two cannot disagree
 * about which shell they are in or which endpoint they read. It reads the
 * bootstrap the SERVER wrote for this request (and, for a desktop shell, the
 * identity the shell injected) rather than sniffing the UA client-side, because
 * the server already parsed it for the very response that carried the page.
 *
 * `desktop` is a parameter so the tests can drive the bridge identity without a
 * real shell; production reads it from `window.__kabmoDesktop`.
 */
export function useShellOffer(
  fetchImpl: typeof fetch = fetch,
  desktop: DesktopIdentity | null = readDesktopIdentity(),
): ShellDownload | null {
  const bootstrap = typeof window === 'undefined' ? undefined : window.__OMP_BOOTSTRAP__;
  const mobile = shellFromBootstrap(bootstrap);
  const fromBridge = desktopShellFromIdentity(desktop);

  // The desktop identity is checked FIRST and is authoritative when present: a
  // desktop shell never carries a mobile UA token, and a page that somehow had
  // both is in the desktop app, whose version is the one being compared.
  //
  // ONE call, with the resolved platform — never two conditional calls. A hook
  // behind an `if` changes the hook order between renders, which React/Preact
  // treats as a different component.
  const platform = fromBridge?.platform ?? mobile?.platform ?? 'android';
  const version = fromBridge?.version ?? mobile?.version ?? null;

  return useShellDownload(
    platform,
    version,
    fromBridge ? null : bootstrap?.isAndroid,
    fetchImpl,
    fromBridge?.arch ?? null,
  );
}

/**
 * The short form the phone's footer prints, where the label has no room.
 *
 * It names the OFFER, and for Android it names the file type because that is
 * what a reader recognises (`APK` is the thing they will see in Downloads). An
 * iOS update is an IPA, which nobody installs by hand — the shell finishes the
 * install itself — so the platform word is the honest one there. A desktop
 * update opens the release page, so it names the platform too.
 */
export function shellDownloadShortLabel(download: ShellDownload): string {
  if (download.platform === 'ios') return 'Update app';
  if (isDesktopShellKind(download.platform)) return `Update ${PLATFORM_NAMES[download.platform]}`;
  return download.kind === 'update' ? 'Update APK' : 'Get APK';
}
