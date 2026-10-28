/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, test } from 'bun:test';

import { versionFromAssetName } from '@/server/lib/updates/shell-assets';

/**
 * The asset name is the only place a shell artifact's version exists: the
 * release TAG names the SERVER version, and the two move independently. A parser
 * that read the tag would compare a server version against a shell version.
 *
 * Both shells are pinned here, because they share the parser and differ only by
 * prefix/extension — the shape that silently accepts the other shell's asset.
 */
describe('versionFromAssetName', () => {
  test('reads the version the release workflows write', () => {
    expect(versionFromAssetName('android', 'Kabmo-0.5.0-android.apk')).toBe('0.5.0');
    expect(versionFromAssetName('ios', 'Kabmo-0.1.0-ios.ipa')).toBe('0.1.0');
  });

  /**
   * The old spelling is still READ, and that is not sentiment.
   *
   * These names are the only record of a published shell, and every release
   * already on GitHub carries `kabmo-android-v<v>.apk`. A parser that only knew
   * the new scheme would answer "no update" for an installed shell the moment
   * this shipped — silently, because a name that does not match reads exactly
   * like a release with no artifact.
   */
  test('still reads the legacy spelling every published release carries', () => {
    expect(versionFromAssetName('android', 'kabmo-android-v0.5.0.apk')).toBe('0.5.0');
    expect(versionFromAssetName('ios', 'kabmo-ios-v0.1.0.ipa')).toBe('0.1.0');
  });

  test('ignores anything that is not that shell’s artifact', () => {
    expect(versionFromAssetName('android', 'Kabmo-1.2.3-android.apk.zip')).toBeNull();
    expect(versionFromAssetName('android', 'source.tar.gz')).toBeNull();
    expect(versionFromAssetName('android', 'Kabmo-latest-android.apk')).toBeNull();
    expect(versionFromAssetName('android', 'Kabmo--android.apk')).toBeNull();
    expect(versionFromAssetName('android', '')).toBeNull();
  });

  /**
   * The desktop assets share the `Kabmo-` prefix, so the EXTENSION is what keeps
   * them out. A probe that matched on the prefix alone would offer a Mac `.dmg`
   * to an Android phone.
   */
  test('does not read a desktop asset as a mobile one', () => {
    for (const name of [
      'Kabmo-0.1.2-mac-arm64.zip',
      'Kabmo-0.1.2-mac-arm64.dmg',
      'Kabmo-0.1.0-win-x64-setup.exe',
      'Kabmo-0.1.0-linux-x86_64.tar.gz',
      'Kabmo-0.1.0-linux-amd64.deb',
      'Kabmo-0.1.0-linux-x86_64.AppImage',
    ]) {
      expect(versionFromAssetName('android', name), name).toBeNull();
      expect(versionFromAssetName('ios', name), name).toBeNull();
    }
  });

  test('does not accept one shell’s asset for the other', () => {
    // The probes read the SAME release list, so a parser that ignored the
    // kind would let an iOS probe answer with the APK (and offer an `.apk` to an
    // iPhone).
    expect(versionFromAssetName('ios', 'Kabmo-0.5.0-android.apk')).toBeNull();
    expect(versionFromAssetName('android', 'Kabmo-0.1.0-ios.ipa')).toBeNull();
    expect(versionFromAssetName('ios', 'kabmo-android-v1.2.3.apk')).toBeNull();
    expect(versionFromAssetName('android', 'kabmo-ios-v1.2.3.ipa')).toBeNull();
  });

  /**
   * The desktop trio, one entry each.
   *
   * A desktop release carries SEVERAL files per platform (two arches × two
   * macOS shapes, four Linux formats), so the match is on the segment after the
   * version rather than the whole name: any one of them answers the same
   * version, and the download the console offers is the release page.
   */
  test('reads every desktop spelling, and only its own platform', () => {
    for (const name of ['Kabmo-0.2.0-mac-arm64.zip', 'Kabmo-0.2.0-mac-x64.dmg']) {
      expect(versionFromAssetName('macos', name), name).toBe('0.2.0');
      expect(versionFromAssetName('windows', name), name).toBeNull();
      expect(versionFromAssetName('linux', name), name).toBeNull();
    }
    for (const name of ['Kabmo-0.2.0-win-x64-setup.exe', 'Kabmo-0.2.0-win-arm64-setup.exe']) {
      expect(versionFromAssetName('windows', name), name).toBe('0.2.0');
      expect(versionFromAssetName('macos', name), name).toBeNull();
    }
    for (const name of [
      'Kabmo-0.2.0-linux-x86_64.tar.gz',
      'Kabmo-0.2.0-linux-arm64.tar.gz',
      'Kabmo-0.2.0-linux-amd64.deb',
      'Kabmo-0.2.0-linux-arm64.rpm',
      'Kabmo-0.2.0-linux-x86_64.AppImage',
    ]) {
      expect(versionFromAssetName('linux', name), name).toBe('0.2.0');
      expect(versionFromAssetName('macos', name), name).toBeNull();
    }
  });

  test('a desktop shell reads no mobile asset, and vice versa', () => {
    // The `Kabmo-` prefix is shared by all five, so a scheme that matched on the
    // prefix alone would offer an APK to a Mac.
    expect(versionFromAssetName('macos', 'Kabmo-0.6.0-android.apk')).toBeNull();
    expect(versionFromAssetName('windows', 'Kabmo-0.2.0-ios.ipa')).toBeNull();
    expect(versionFromAssetName('linux', 'Kabmo-0.6.0-android.apk')).toBeNull();
    expect(versionFromAssetName('android', 'Kabmo-0.2.0-linux-x86_64.tar.gz')).toBeNull();
    expect(versionFromAssetName('ios', 'Kabmo-0.2.0-win-x64-setup.exe')).toBeNull();
  });
});
