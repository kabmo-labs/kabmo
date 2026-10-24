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

import type { ShellArch } from '@/shared/lib/updates/shell-arch';
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
 * one of them answers the same version, which is all `pattern` is for.
 *
 * WHICH file the console hands back is a second question, and `selfUpdate` is
 * the answer: a desktop shell that knows its architecture installs one exact
 * artifact, and a probe that does not know it still gets the release page. Both
 * live in this table so the route, the pages fallback and the tests read one
 * spelling.
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
   * Whether the payload's `url` should be the artifact itself. True for the
   * mobile pair, whose artifact is the same file on every device.
   */
  directDownload: boolean;
  /**
   * The ONE file a desktop shell installs ITSELF from, per architecture.
   *
   * `null` for the mobile pair: an APK is installed by `PackageInstaller` and an
   * IPA cannot be installed at all, so neither is this shell's own business.
   *
   * The desktop entry is deliberately narrower than `pattern`: one release
   * carries several files per platform (`.zip` and `.dmg`, `.tar.gz`/`.deb`/
   * `.rpm`/`.AppImage`), and only ONE of each is something the shell can install
   * without a human opening it. The choice is stated here rather than at the
   * call site so the route, the pages fallback and the tests cannot disagree
   * about which file "the update" means.
   */
  selfUpdate: SelfUpdateScheme | null;
}

/**
 * How one desktop shell's self-update artifact is named.
 *
 * `pattern` captures the version AND the architecture, because the two answers
 * come from the same string: the version is what the console compares against
 * the installed build, and the architecture is what makes this file the right
 * one for the machine asking.
 */
export interface SelfUpdateScheme {
  /** `Kabmo-<version>-<platform>-<arch><suffix>` → `[name, version, arch]`. */
  pattern: RegExp;
  /** How each canonical arch is spelled in the ASSET name. */
  assetArch: Record<ShellArch, string>;
}

const VERSION = String.raw`(\d+\.\d+\.\d+)`;

/** `arm64`/`x64` as macOS and Windows spell them. */
const SAME_ARCH: Record<ShellArch, string> = { arm64: 'arm64', x64: 'x64' };

/** Linux says `x86_64` where the other two say `x64`. */
const LINUX_ARCH: Record<ShellArch, string> = { arm64: 'arm64', x64: 'x86_64' };

export const SHELL_ASSETS: Record<ShellKind, AssetScheme> = {
  android: {
    pattern: new RegExp(`^Kabmo-${VERSION}-android\\.apk$`),
    current: /^Kabmo-\d/,
    legacy: { prefix: 'kabmo-android-v', extension: '.apk' },
    directDownload: true,
    selfUpdate: null,
  },
  ios: {
    pattern: new RegExp(`^Kabmo-${VERSION}-ios\\.ipa$`),
    current: /^Kabmo-\d/,
    legacy: { prefix: 'kabmo-ios-v', extension: '.ipa' },
    directDownload: true,
    selfUpdate: null,
  },
  macos: {
    pattern: new RegExp(`^Kabmo-${VERSION}-mac-`),
    current: /^Kabmo-\d/,
    legacy: null,
    directDownload: false,
    // The `.zip`, not the `.dmg`: `ditto -x -k` extracts it without mounting a
    // volume, and the shell has to be able to do that with no human present.
    // Both shapes are published; only one is installable by the app itself.
    selfUpdate: {
      pattern: new RegExp(`^Kabmo-${VERSION}-mac-(arm64|x64)\\.zip$`),
      assetArch: SAME_ARCH,
    },
  },
  windows: {
    pattern: new RegExp(`^Kabmo-${VERSION}-win-`),
    current: /^Kabmo-\d/,
    legacy: null,
    directDownload: false,
    // The INSTALLER, not the `.zip`-shaped publish output: Inno already owns the
    // upgrade semantics (a stable `AppId` is what makes an install an upgrade
    // rather than a second copy), and `/CLOSEAPPLICATIONS` is how it replaces a
    // running exe.
    selfUpdate: {
      pattern: new RegExp(`^Kabmo-${VERSION}-win-(arm64|x64)-setup\\.exe$`),
      assetArch: SAME_ARCH,
    },
  },
  linux: {
    pattern: new RegExp(`^Kabmo-${VERSION}-linux-`),
    current: /^Kabmo-\d/,
    legacy: null,
    directDownload: false,
    // The AppImage, and only it: `.deb`/`.rpm` need root and a package manager,
    // so a shell cannot install them — it says so instead. An AppImage is ONE
    // file the shell can replace atomically and re-exec.
    selfUpdate: {
      pattern: new RegExp(`^Kabmo-${VERSION}-linux-(arm64|x86_64)\\.AppImage$`),
      assetArch: LINUX_ARCH,
    },
  },
};

/**
 * The self-update artifact for one architecture, if this name is it.
 *
 * Null for a shell that has no self-update, for an arch it does not publish, and
 * for every other file in the release (a `.dmg`, a `.deb`, the OTHER
 * architecture's build). Callers treat null as "not the file this machine
 * installs", which is why the route falls back to the release page rather than
 * guessing.
 */
export function selfUpdateArtifact(
  kind: ShellKind,
  arch: ShellArch,
  name: string,
): { version: string } | null {
  const scheme = SHELL_ASSETS[kind].selfUpdate;
  if (!scheme) return null;

  const match = scheme.pattern.exec(name);
  if (!match) return null;
  // The captured arch is compared against the ASSET spelling, so a Linux build
  // reporting `x64` matches `…-linux-x86_64.AppImage` and nothing else.
  if (match[2] !== scheme.assetArch[arch]) return null;
  return { version: match[1] ?? '' };
}

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
