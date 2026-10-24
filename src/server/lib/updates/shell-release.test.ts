/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, test } from 'bun:test';

import { fetchShellRelease, resetShellReleaseCache } from '@/server/lib/updates/shell-release';

/**
 * A fetch double that answers one body, and counts its calls.
 *
 * `text()` is provided as well as `json()`: the public-pages fallback reads Atom
 * and HTML, and a stub that only answered `json()` would throw inside it and make
 * a broken parse look like a clean "no release" — the exact confusion these
 * tests exist to prevent.
 */
function stubFetch(body: unknown, ok = true) {
  const calls: string[] = [];
  const impl = (async (input: string | URL | Request) => {
    calls.push(String(input));
    return {
      ok,
      json: async () => body,
      text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    } as Response;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

/**
 * A double that routes by URL, for the two-path probe.
 *
 * `api` answers the REST read (or fails, which is what a spent quota does) and
 * `pages` answers the Atom feed and each release's asset fragment. Returning
 * `null` for a route means "this request fails", which is how the fallback is
 * entered at all.
 */
function routedFetch(routes: {
  api?: unknown;
  atom?: string;
  assets?: Record<string, string>;
}) {
  const calls: string[] = [];
  const impl = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);

    if (url.includes('/repos/')) {
      if (routes.api === undefined) return { ok: false, json: async () => ({}), text: async () => '' } as Response;
      return { ok: true, json: async () => routes.api, text: async () => JSON.stringify(routes.api) } as Response;
    }
    if (url.endsWith('/releases.atom')) {
      const body = routes.atom ?? '';
      return { ok: Boolean(routes.atom), json: async () => ({}), text: async () => body } as Response;
    }
    const tag = url.slice(url.lastIndexOf('/') + 1);
    const body = routes.assets?.[decodeURIComponent(tag)];
    return { ok: body !== undefined, json: async () => ({}), text: async () => body ?? '' } as Response;
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
      direct: true,
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
      direct: true,
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
      direct: true,
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
      direct: true,
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
    expect(await fetchShellRelease('android', impl)).toEqual({
      url: null,
      latest: null,
      releaseUrl: null,
      direct: false,
    });
  });

  test('answers null when the probe fails', async () => {
    // An offline box must not take the sidebar down, and a failure must not be
    // read as "no newer version" either — it is simply no offer. BOTH paths are
    // down here: the API refuses and the feed is unreachable, which is the only
    // shape that means "cannot ask" rather than "nothing published".
    const { impl } = routedFetch({});
    expect(await fetchShellRelease('android', impl)).toBeNull();
  });

  test('answers null when the body is malformed', async () => {
    // The API answers 200 with something that is not a release list, and the
    // feed is unreachable — the API's answer is a failed probe, not an empty
    // repository.
    const { impl } = routedFetch({ api: { assets: 'nope' } });
    expect(await fetchShellRelease('android', impl)).toBeNull();
  });
});
