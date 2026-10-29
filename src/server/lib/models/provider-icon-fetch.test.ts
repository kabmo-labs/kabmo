/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The icon chain: the endpoint's own host, then the registrable domain behind
 * it, then nothing.
 *
 * The failure this pins is the one that left every gateway on its initials: an
 * API host (`api.kenari.id`) serves no page, while the apex serves the brand's
 * logo. Both directions matter — the base domain must be reachable AND must
 * never pre-empt a logo the endpoint host actually publishes.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { fetchProviderIcon } from '@/server/lib/models/provider-icon-fetch';

/** A real PNG signature: the fetch layer sniffs bytes and refuses anything else. */
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
const realFetch = Bun.fetch;
const requested: string[] = [];

/**
 * Answer per origin: `{ html }` for a page that declares `icon`, `{ icon }` for
 * a picture at that URL, `{ missing: true }` for a host with nothing on it.
 */
function stubHosts(hosts: Record<string, { html?: string; icon?: string }>): void {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    requested.push(url);
    const origin = new URL(url).origin;
    const host = hosts[origin];
    if (!host) return new Response('not found', { status: 404 });
    // The page read is `fetch(origin)` — no trailing slash on the request URL.
    if (url.replace(/\/$/, '') === origin && host.html) {
      return new Response(host.html, { headers: { 'content-type': 'text/html' } });
    }
    if (host.icon && url === `${origin}${host.icon}`) {
      return new Response(PNG, { headers: { 'content-type': 'image/png' } });
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = realFetch;
  requested.length = 0;
});

describe('fetchProviderIcon — endpoint host, then base domain', () => {
  test('falls back to the base domain when the API host serves no icon', async () => {
    stubHosts({
      'https://api.kenari.id': {},
      'https://kenari.id': { html: '<link rel="icon" href="/brand.png" sizes="192x192">', icon: '/brand.png' },
    });

    const icon = await fetchProviderIcon('https://api.kenari.id/v1');

    expect(icon?.source).toBe('https://kenari.id/brand.png');
    expect(icon?.mime).toBe('image/png');
  });

  test('the endpoint host wins when it has its own icon', async () => {
    stubHosts({
      'https://api.kenari.id': { html: '<link rel="icon" href="/own.png">', icon: '/own.png' },
      'https://kenari.id': { html: '<link rel="icon" href="/brand.png">', icon: '/brand.png' },
    });

    const icon = await fetchProviderIcon('https://api.kenari.id/v1');

    expect(icon?.source).toBe('https://api.kenari.id/own.png');
    expect(requested.some((url) => url.startsWith('https://kenari.id'))).toBe(false);
  });

  test('neither host having an icon is null, after trying both', async () => {
    stubHosts({ 'https://api.kenari.id': {}, 'https://kenari.id': {} });

    expect(await fetchProviderIcon('https://api.kenari.id/v1')).toBeNull();
    expect(requested).toContain('https://api.kenari.id');
    expect(requested).toContain('https://kenari.id');
    expect(requested).toContain('https://kenari.id/favicon.ico');
  });

  test('a shared platform apex is never read as the site', async () => {
    stubHosts({ 'https://demo.vercel.app': {}, 'https://vercel.app': { html: '<link rel="icon" href="/v.png">', icon: '/v.png' } });

    expect(await fetchProviderIcon('https://demo.vercel.app/v1')).toBeNull();
    expect(requested.every((url) => url.startsWith('https://demo.vercel.app'))).toBe(true);
  });
});
