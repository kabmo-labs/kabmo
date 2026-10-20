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
    const { impl } = stubFetch({
      html_url: 'https://github.com/kabmo-labs/kabmo/releases/tag/v9.9.9',
      assets: [
        { name: 'source.tar.gz', browser_download_url: 'https://x/src.tgz' },
        {
          name: 'kabmo-android-v1.2.3.apk',
          browser_download_url: 'https://x/kabmo-android-v1.2.3.apk',
        },
      ],
    });

    const release = await fetchAndroidRelease(impl);
    expect(release).toEqual({
      url: 'https://x/kabmo-android-v1.2.3.apk',
      latest: '1.2.3',
      releaseUrl: 'https://github.com/kabmo-labs/kabmo/releases/tag/v9.9.9',
    });
  });

  test('answers null for a release with no APK', async () => {
    const { impl } = stubFetch({ html_url: 'https://x', assets: [{ name: 'notes.md' }] });
    const release = await fetchAndroidRelease(impl);
    expect(release).toEqual({ url: null, latest: null, releaseUrl: 'https://x' });
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
