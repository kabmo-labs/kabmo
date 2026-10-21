/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, test } from 'bun:test';

import {
  fetchAndroidRelease,
  resetAndroidReleaseCache,
  versionFromAssetName,
} from '@/server/lib/updates/android-release';

/**
 * The asset name is the only place the APK's version exists: the release TAG
 * names the SERVER version, and the two move independently. A parser that read
 * the tag would compare a server version against an APK version.
 */
describe('versionFromAssetName', () => {
  test('reads the version the release workflow writes', () => {
    expect(versionFromAssetName('kabmo-android-v1.2.3.apk')).toBe('1.2.3');
  });

  test('accepts a hand-uploaded name without the v', () => {
    expect(versionFromAssetName('kabmo-android-1.2.3.apk')).toBe('1.2.3');
  });

  test('ignores anything that is not the APK', () => {
    expect(versionFromAssetName('kabmo-android-v1.2.3.apk.zip')).toBeNull();
    expect(versionFromAssetName('source.tar.gz')).toBeNull();
    expect(versionFromAssetName('kabmo-android-latest.apk')).toBeNull();
    expect(versionFromAssetName('')).toBeNull();
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

describe('fetchAndroidRelease', () => {
  // The cache is process-wide (see `resetAndroidReleaseCache`), so every case
  // starts from a cold one or it reads the previous case's answer.
  beforeEach(() => resetAndroidReleaseCache());

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

    const release = await fetchAndroidRelease(impl);
    expect(release).toEqual({
      url: 'https://x/kabmo-android-v1.2.3.apk',
      latest: '1.2.3',
      releaseUrl: 'https://github.com/kabmo-labs/kabmo/releases/tag/v9.9.9',
    });
  });

  test('skips a newer release that carries no APK', async () => {
    // This is the shape that broke the button: `release.yml` releases the npm
    // packages FIRST, so `kabmo-sdk/v0.0.2` is newer than the app release that
    // holds the APK. Asking `/releases/latest` answered the package release and
    // the button vanished while the APK sat one entry below.
    const { impl } = stubFetch([
      { html_url: 'https://x/kabmo-sdk', assets: [{ name: 'source.tar.gz' }] },
      { html_url: 'https://x/kabmo-ui', assets: [] },
      {
        html_url: 'https://x/app',
        assets: [{ name: 'kabmo-android-v0.3.0.apk', browser_download_url: 'https://x/a.apk' }],
      },
    ]);

    expect(await fetchAndroidRelease(impl)).toEqual({
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

    expect((await fetchAndroidRelease(impl))?.latest).toBe('0.3.0');
  });

  test('answers null for a list with no APK anywhere', async () => {
    const { impl } = stubFetch([
      { html_url: 'https://x', assets: [{ name: 'notes.md' }] },
      { html_url: 'https://y', assets: [] },
    ]);
    expect(await fetchAndroidRelease(impl)).toEqual({ url: null, latest: null, releaseUrl: null });
  });

  test('answers null when the probe fails', async () => {
    // An offline box or a rate-limited GitHub must not take the sidebar down,
    // and a failure must not be read as "no newer version" either — it is
    // simply no offer.
    const { impl } = stubFetch({}, false);
    expect(await fetchAndroidRelease(impl)).toBeNull();
  });

  test('answers null when the body is malformed', async () => {
    const { impl } = stubFetch({ assets: 'nope' });
    expect(await fetchAndroidRelease(impl)).toBeNull();
  });
});
