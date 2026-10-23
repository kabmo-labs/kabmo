/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, test } from 'bun:test';

import { fetchShellRelease, resetShellReleaseCache, versionFromAssetName } from '@/server/lib/updates/shell-release';

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
    // The two probes read the SAME release list, so a parser that ignored the
    // kind would let an iOS probe answer with the APK (and offer an `.apk` to an
    // iPhone).
    expect(versionFromAssetName('ios', 'Kabmo-0.5.0-android.apk')).toBeNull();
    expect(versionFromAssetName('android', 'Kabmo-0.1.0-ios.ipa')).toBeNull();
    expect(versionFromAssetName('ios', 'kabmo-android-v1.2.3.apk')).toBeNull();
    expect(versionFromAssetName('android', 'kabmo-ios-v1.2.3.ipa')).toBeNull();
  });
});

/** A fetch double that answers one body, and counts its calls. */
function stubFetch(body: unknown, ok = true) {
  const calls: string[] = [];
  const impl = (async (input: string | URL | Request) => {
    calls.push(String(input));
    return {
      ok,
      json: async () => body,
    } as Response;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe('fetchShellRelease', () => {
  // The cache is process-wide (see `resetShellReleaseCache`), so every case
  // starts from a cold one or it reads the previous case's answer.
  beforeEach(() => resetShellReleaseCache());

  test('picks the APK asset and its version', async () => {
    const { impl } = stubFetch([
      {
        html_url: 'https://github.com/kabmo-labs/kabmo/releases/tag/v9.9.9',
        assets: [
          { name: 'source.tar.gz', browser_download_url: 'https://x/src.tgz' },
          {
            name: 'Kabmo-1.2.3-android.apk',
            browser_download_url: 'https://x/Kabmo-1.2.3-android.apk',
          },
        ],
      },
    ]);

    expect(await fetchShellRelease('android', impl)).toEqual({
      url: 'https://x/Kabmo-1.2.3-android.apk',
      latest: '1.2.3',
      releaseUrl: 'https://github.com/kabmo-labs/kabmo/releases/tag/v9.9.9',
    });
  });

  test('picks the IPA asset for the iOS probe', async () => {
    const { impl } = stubFetch([
      {
        html_url: 'https://x/app',
        assets: [
          { name: 'Kabmo-0.9.0-android.apk', browser_download_url: 'https://x/a.apk' },
          { name: 'Kabmo-0.4.0-ios.ipa', browser_download_url: 'https://x/i.ipa' },
        ],
      },
    ]);

    expect(await fetchShellRelease('ios', impl)).toEqual({
      url: 'https://x/i.ipa',
      latest: '0.4.0',
      releaseUrl: 'https://x/app',
    });
  });

  /**
   * A release that carries BOTH spellings must answer with the current one.
   *
   * That state is real: a rename lands, and the previous release's asset stays
   * beside the new one until `--clobber` replaces it (or a hand-upload adds
   * one). Measured before the fix: a release holding both
   * `kabmo-android-v0.4.0.apk` and `Kabmo-0.6.0-android.apk` answered `0.4.0` —
   * the console offered an update to the version the user already had, and hid
   * the newer one.
   */
  test('prefers the current scheme when a release carries both', async () => {
    const { impl } = stubFetch([
      {
        html_url: 'https://x/r',
        assets: [
          { name: 'kabmo-android-v0.4.0.apk', browser_download_url: 'https://x/old.apk' },
          { name: 'Kabmo-0.6.0-android.apk', browser_download_url: 'https://x/new.apk' },
        ],
      },
    ]);

    expect(await fetchShellRelease('android', impl)).toEqual({
      url: 'https://x/new.apk',
      latest: '0.6.0',
      releaseUrl: 'https://x/r',
    });
  });

  /** A release carrying ONLY the old spelling must keep answering. */
  test('still resolves a release that only has the legacy spelling', async () => {
    const { impl } = stubFetch([
      {
        html_url: 'https://x/r2',
        assets: [{ name: 'kabmo-android-v0.4.0.apk', browser_download_url: 'https://x/old.apk' }],
      },
    ]);

    expect((await fetchShellRelease('android', impl))?.latest).toBe('0.4.0');
  });

  test('the two shells cache separately', async () => {
    // One shared slot would make the second probe answer with the first one's
    // artifact — the release list is the same read, the asset is not.
    const release = {
      html_url: 'https://x/app',
      assets: [
        { name: 'Kabmo-1.0.0-android.apk', browser_download_url: 'https://x/a.apk' },
        { name: 'Kabmo-2.0.0-ios.ipa', browser_download_url: 'https://x/i.ipa' },
      ],
    };
    expect((await fetchShellRelease('android', stubFetch([release]).impl))?.latest).toBe('1.0.0');
    expect((await fetchShellRelease('ios', stubFetch([release]).impl))?.latest).toBe('2.0.0');

    // …and a reset of one leaves the other's answer in place.
    resetShellReleaseCache('android');
    const { impl, calls } = stubFetch([release]);
    expect((await fetchShellRelease('ios', impl))?.latest).toBe('2.0.0');
    expect(calls, 'a cached answer must not re-read GitHub').toHaveLength(0);
  });

  test('skips a newer release that carries no artifact', async () => {
    // This is the shape that broke the button: `release.yml` releases the npm
    // packages FIRST, so `kabmo-sdk/v0.0.2` is newer than the app release that
    // holds the shell. Asking `/releases/latest` answered the package release and
    // the button vanished while the artifact sat one entry below.
    const { impl } = stubFetch([
      { html_url: 'https://x/kabmo-sdk', assets: [{ name: 'source.tar.gz' }] },
      { html_url: 'https://x/kabmo-ui', assets: [] },
      {
        html_url: 'https://x/app',
        assets: [{ name: 'Kabmo-0.3.0-android.apk', browser_download_url: 'https://x/a.apk' }],
      },
    ]);

    expect(await fetchShellRelease('android', impl)).toEqual({
      url: 'https://x/a.apk',
      latest: '0.3.0',
      releaseUrl: 'https://x/app',
    });
  });

  test('skips drafts and prereleases', async () => {
    const { impl } = stubFetch([
      {
        draft: true,
        html_url: 'https://x/draft',
        assets: [{ name: 'Kabmo-9.9.9-android.apk', browser_download_url: 'https://x/draft.apk' }],
      },
      {
        prerelease: true,
        html_url: 'https://x/pre',
        assets: [{ name: 'Kabmo-8.0.0-android.apk', browser_download_url: 'https://x/pre.apk' }],
      },
      {
        html_url: 'https://x/app',
        assets: [{ name: 'Kabmo-0.3.0-android.apk', browser_download_url: 'https://x/a.apk' }],
      },
    ]);

    expect((await fetchShellRelease('android', impl))?.latest).toBe('0.3.0');
  });

  test('answers an empty result for a list with no artifact anywhere', async () => {
    const { impl } = stubFetch([
      { html_url: 'https://x', assets: [{ name: 'notes.md' }] },
      { html_url: 'https://y', assets: [] },
    ]);
    expect(await fetchShellRelease('android', impl)).toEqual({ url: null, latest: null, releaseUrl: null });
  });

  test('answers null when the probe fails', async () => {
    // An offline box or a rate-limited GitHub must not take the sidebar down,
    // and a failure must not be read as "no newer version" either — it is
    // simply no offer.
    const { impl } = stubFetch({}, false);
    expect(await fetchShellRelease('android', impl)).toBeNull();
  });

  test('answers null when the body is malformed', async () => {
    const { impl } = stubFetch({ assets: 'nope' });
    expect(await fetchShellRelease('android', impl)).toBeNull();
  });
});
