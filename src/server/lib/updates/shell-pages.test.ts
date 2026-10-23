/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, test } from 'bun:test';

import { fetchShellRelease, resetShellReleaseCache } from '@/server/lib/updates/shell-release';
import { releaseTags } from '@/server/lib/updates/shell-pages';


/**
 * A double that routes by URL, for the two-path probe.
 *
 * `api` answers the REST read (or fails, which is what a spent quota does) and
 * the pages answer the Atom feed and each release's asset fragment. Returning
 * `undefined` for a route means "this request fails", which is how the fallback
 * is entered at all.
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

/**
 * The public-pages fallback, and the reason it exists.
 *
 * The REST read is unauthenticated at 60 requests an hour per source IP, and on a
 * mobile network that IP is a carrier NAT shared with an entire subscriber base.
 * Measured on the author's machine: `remaining: 0`, so the probe answered `null`
 * and the console drew no update button for an APK two versions behind the
 * published one — a missing button being indistinguishable from "you are up to
 * date". These cases pin the second path, which is what the report needed.
 */
describe('the fallback when the API is unavailable', () => {
  beforeEach(() => resetShellReleaseCache());

  const ATOM = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Release notes from kabmo</title>
  <entry>
    <id>tag:github.com,2008:Repository/1/v0.7.0</id>
    <link rel="alternate" type="text/html" href="https://github.com/kabmo-labs/kabmo/releases/tag/v0.7.0"/>
    <title>v0.7.0</title>
  </entry>
  <entry>
    <link rel="alternate" type="text/html" href="https://github.com/kabmo-labs/kabmo/releases/tag/kabmo-sdk/v0.1.0"/>
    <title>kabmo-sdk/v0.1.0</title>
  </entry>
  <entry>
    <link rel="alternate" type="text/html" href="https://github.com/kabmo-labs/kabmo/releases/tag/v0.6.1"/>
    <title>v0.6.1</title>
  </entry>
</feed>`;

  /** The fragment GitHub's release page loads, trimmed to its asset links. */
  const ASSETS_V070 = `
<div class="Box">
  <li><a href="/kabmo-labs/kabmo/releases/download/v0.7.0/Kabmo-0.6.0-android.apk"><span class="text-bold">Kabmo-0.6.0-android.apk</span></a></li>
  <li><a href="/kabmo-labs/kabmo/releases/download/v0.7.0/Kabmo-0.2.0-mac-arm64.zip"><span class="text-bold">Kabmo-0.2.0-mac-arm64.zip</span></a></li>
</div>`;

  test('resolves the APK when the API read is refused', async () => {
    // `api: undefined` is a spent quota: the route answers 403 with a body that
    // is not a release list.
    const { impl, calls } = routedFetch({ atom: ATOM, assets: { 'v0.7.0': ASSETS_V070 } });

    expect(await fetchShellRelease('android', impl)).toEqual({
      url: 'https://github.com/kabmo-labs/kabmo/releases/download/v0.7.0/Kabmo-0.6.0-android.apk',
      latest: '0.6.0',
      releaseUrl: 'https://github.com/kabmo-labs/kabmo/releases/tag/v0.7.0',
    });
    expect(calls.some((url) => url.includes('/repos/'))).toBe(true);
    expect(calls.some((url) => url.endsWith('/releases.atom'))).toBe(true);
  });

  test('walks past a release that carries no artifact of this shell', async () => {
    // The packages are released FIRST, so the newest tag is often a
    // `kabmo-sdk/v*` release with no shell in it — the same shape that made
    // `/releases/latest` wrong.
    const { impl } = routedFetch({
      atom: ATOM,
      assets: { 'kabmo-sdk/v0.1.0': '<div>no assets</div>', 'v0.7.0': ASSETS_V070 },
    });

    expect((await fetchShellRelease('android', impl))?.latest).toBe('0.6.0');
  });

  test('answers the release page for a desktop shell', async () => {
    const { impl } = routedFetch({ atom: ATOM, assets: { 'v0.7.0': ASSETS_V070 } });

    expect(await fetchShellRelease('macos', impl)).toEqual({
      url: 'https://github.com/kabmo-labs/kabmo/releases/tag/v0.7.0',
      latest: '0.2.0',
      releaseUrl: 'https://github.com/kabmo-labs/kabmo/releases/tag/v0.7.0',
    });
  });

  test('a release with no artifact anywhere answers empty, not null', async () => {
    // "The read worked and there is nothing" and "the read failed" must stay
    // distinguishable: the first is cacheable and the second keeps the last good
    // answer.
    const { impl } = routedFetch({ atom: ATOM, assets: { 'v0.7.0': '<div></div>' } });
    expect(await fetchShellRelease('android', impl)).toEqual({ url: null, latest: null, releaseUrl: null });
  });

  test('an unreachable feed answers null rather than an empty result', async () => {
    const { impl } = routedFetch({});
    expect(await fetchShellRelease('android', impl)).toBeNull();
  });

  test('the API answer wins when it works, so the fallback costs nothing', async () => {
    const { impl, calls } = routedFetch({
      api: [
        {
          html_url: 'https://x/api',
          assets: [{ name: 'Kabmo-1.0.0-android.apk', browser_download_url: 'https://x/a.apk' }],
        },
      ],
      atom: ATOM,
      assets: { 'v0.7.0': ASSETS_V070 },
    });

    expect((await fetchShellRelease('android', impl))?.latest).toBe('1.0.0');
    expect(calls.some((url) => url.endsWith('/releases.atom'))).toBe(false);
  });

  test('releaseTags reads the feed in order, with each page', () => {
    expect(releaseTags(ATOM)).toEqual([
      { name: 'v0.7.0', url: 'https://github.com/kabmo-labs/kabmo/releases/tag/v0.7.0' },
      { name: 'kabmo-sdk/v0.1.0', url: 'https://github.com/kabmo-labs/kabmo/releases/tag/kabmo-sdk/v0.1.0' },
      { name: 'v0.6.1', url: 'https://github.com/kabmo-labs/kabmo/releases/tag/v0.6.1' },
    ]);
    expect(releaseTags('')).toEqual([]);
  });
});
