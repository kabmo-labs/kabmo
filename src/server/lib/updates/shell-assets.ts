/**
 * How each native shell's release asset is NAMED, and what version it declares.
 *
 * Split from `shell-release.ts` because that file owns the two READS (the REST
 * API and the public-pages fallback) and this one owns the naming rules, and
 * because the repo's ceiling is 350 lines per file — the two concerns together
 * crossed it.
 *
 * The naming is the load-bearing half: the asset NAME is the only place a shell
 * artifact's version exists. The release TAG names the SERVER version, and the
 * two move independently, so a parser that read the tag would compare a server
 * version against a shell version.
 */

import type { ShellKind } from '@/shared/lib/updates/shell-ua';

/**
 * One shell's asset scheme, plus the spelling it carried BEFORE the rename.
 *
 * ONE scheme for every shell in the project — `<App>-<version>-<platform>…`:
 * `Kabmo-0.5.0-android.apk`, `Kabmo-0.1.0-ios.ipa`, and the desktop trio's
 * `Kabmo-0.2.0-mac-arm64.dmg` / `-win-x64-setup.exe` / `-linux-x86_64.tar.gz`.
 * The mobile pair carries no architecture because neither artifact is per-arch:
 * the APK is one universal build (the shell is pure Kotlin with no native
 * libraries, so there is nothing to split), and the IPA contains only the device
 * slice (`arm64-apple-ios`).
 *
 * The desktop entries match on the segment AFTER the version rather than on the
 * whole name, because one release carries several files per platform
 * (`-mac-arm64.zip` and `-mac-arm64.dmg`, four Linux formats, two arches). Any
 * one of them answers the same version, and the download is the release page.
 *
 * **`legacy` is not dead code.** These names are PARSED to answer "is a newer
 * shell published", and every release already on GitHub carries the old mobile
 * spelling. Dropping it would make the console answer "no update" for an
 * installed shell the moment this ships — silently, because a name that does not
 * match reads exactly like a release with no artifact. The desktop trio has no
 * legacy spelling: they were born under the current scheme.
 */
export interface AssetScheme {
  /** The whole-name pattern for the mobile pair, the segment for the desktops. */
  pattern: RegExp;
  /** The prefix that marks the CURRENT scheme, for "prefer the new spelling". */
  current: RegExp;
  /** The old mobile spelling, or null for a shell that never had one. */
  legacy: { prefix: string; extension: string } | null;
  /**
   * Whether the payload's `url` should be the artifact itself. False for a
   * per-arch desktop build, where the release page is the only honest link.
   */
  directDownload: boolean;
}

const VERSION = String.raw`(\d+\.\d+\.\d+)`;

export const SHELL_ASSETS: Record<ShellKind, AssetScheme> = {
  android: {
    pattern: new RegExp(`^Kabmo-${VERSION}-android\\.apk$`),
    current: /^Kabmo-\d/,
    legacy: { prefix: 'kabmo-android-v', extension: '.apk' },
    directDownload: true,
  },
  ios: {
    pattern: new RegExp(`^Kabmo-${VERSION}-ios\\.ipa$`),
    current: /^Kabmo-\d/,
    legacy: { prefix: 'kabmo-ios-v', extension: '.ipa' },
    directDownload: true,
  },
  macos: {
    pattern: new RegExp(`^Kabmo-${VERSION}-mac-`),
    current: /^Kabmo-\d/,
    legacy: null,
    directDownload: false,
  },
  windows: {
    pattern: new RegExp(`^Kabmo-${VERSION}-win-`),
    current: /^Kabmo-\d/,
    legacy: null,
    directDownload: false,
  },
  linux: {
    pattern: new RegExp(`^Kabmo-${VERSION}-linux-`),
    current: /^Kabmo-\d/,
    legacy: null,
    directDownload: false,
  },
};

/**
 * `Kabmo-0.5.0-android.apk` → `0.5.0`, the `.ipa` twin, every desktop spelling,
 * plus the legacy `kabmo-android-v0.5.0.apk` the older releases still carry.
 */
export function versionFromAssetName(kind: ShellKind, name: string): string | null {
  const scheme = SHELL_ASSETS[kind];

  const current = scheme.pattern.exec(name);
  if (current) return current[1] ?? null;

  // Legacy: `kabmo-android-v<version>.apk`. Kept for the releases already
  // published; no new release writes it.
  const legacy = scheme.legacy;
  if (legacy && name.startsWith(legacy.prefix) && name.endsWith(legacy.extension)) {
    const middle = name.slice(legacy.prefix.length, -legacy.extension.length);
    const version = middle.startsWith('v') ? middle.slice(1) : middle;
    return /^\d+\.\d+\.\d+$/.test(version) ? version : null;
  }

  return null;
}
