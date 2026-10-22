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
    expect(versionFromAssetName('android', 'kabmo-android-v1.2.3.apk')).toBe('1.2.3');
    expect(versionFromAssetName('ios', 'kabmo-ios-v1.2.3.ipa')).toBe('1.2.3');
  });

  test('accepts a hand-uploaded name without the v', () => {
    expect(versionFromAssetName('android', 'kabmo-android-1.2.3.apk')).toBe('1.2.3');
    expect(versionFromAssetName('ios', 'kabmo-ios-1.2.3.ipa')).toBe('1.2.3');
  });

  test('ignores anything that is not that shell’s artifact', () => {
    expect(versionFromAssetName('android', 'kabmo-android-v1.2.3.apk.zip')).toBeNull();
    expect(versionFromAssetName('android', 'source.tar.gz')).toBeNull();
    expect(versionFromAssetName('android', 'kabmo-android-latest.apk')).toBeNull();
    expect(versionFromAssetName('android', '')).toBeNull();
  });

  test('does not accept one shell’s asset for the other', () => {
    // The two probes read the SAME release list, so a parser that ignored the
    // kind would let an iOS probe answer with the APK (and offer an `.apk` to an
    // iPhone).
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
            name: 'kabmo-android-v1.2.3.apk',
            browser_download_url: 'https://x/kabmo-android-v1.2.3.apk',
          },
        ],
      },
    ]);

    expect(await fetchShellRelease('android', impl)).toEqual({
      url: 'https://x/kabmo-android-v1.2.3.apk',
      latest: '1.2.3',
      releaseUrl: 'https://github.com/kabmo-labs/kabmo/releases/tag/v9.9.9',
    });
  });

  test('picks the IPA asset for the iOS probe', async () => {
    const { impl } = stubFetch([
      {
        html_url: 'https://x/app',
        assets: [
          { name: 'kabmo-android-v0.9.0.apk', browser_download_url: 'https://x/a.apk' },
          { name: 'kabmo-ios-v0.4.0.ipa', browser_download_url: 'https://x/i.ipa' },
        ],
      },
    ]);

    expect(await fetchShellRelease('ios', impl)).toEqual({
      url: 'https://x/i.ipa',
      latest: '0.4.0',
      releaseUrl: 'https://x/app',
    });
  });

  test('the two shells cache separately', async () => {
    // One shared slot would make the second probe answer with the first one's
    // artifact — the release list is the same read, the asset is not.
    const release = {
      html_url: 'https://x/app',
      assets: [
        { name: 'kabmo-android-v1.0.0.apk', browser_download_url: 'https://x/a.apk' },
        { name: 'kabmo-ios-v2.0.0.ipa', browser_download_url: 'https://x/i.ipa' },
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
        assets: [{ name: 'kabmo-android-v0.3.0.apk', browser_download_url: 'https://x/a.apk' }],
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
        assets: [{ name: 'kabmo-android-v9.9.9.apk', browser_download_url: 'https://x/draft.apk' }],
      },
      {
        prerelease: true,
        html_url: 'https://x/pre',
        assets: [{ name: 'kabmo-android-v8.0.0.apk', browser_download_url: 'https://x/pre.apk' }],
      },
      {
        html_url: 'https://x/app',
        assets: [{ name: 'kabmo-android-v0.3.0.apk', browser_download_url: 'https://x/a.apk' }],
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
