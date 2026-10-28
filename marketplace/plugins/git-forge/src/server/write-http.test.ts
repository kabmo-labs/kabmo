/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The write path: a mutating request and the invalidation it owes.
 *
 * The two properties here are the ones a cached read gets wrong by default: a
 * write must never carry a validator (a replayed 304 would report success for
 * something that did not happen), and its success must DROP the entries it
 * changed — the item and the list it came from are different URLs.
 */

import { describe, expect, test } from 'bun:test';

import { cacheKey, type CachedResponse, type JsonCache } from './http';
import { invalidateWhere, sendJson } from './write-http';

/** An in-memory cache with the plugin's storage shape. */
function memoryCache(): JsonCache & { entries: Map<string, CachedResponse> } {
  const entries = new Map<string, CachedResponse>();
  return {
    entries,
    read: async (key) => entries.get(key),
    write: async (key, entry) => {
      entries.set(key, entry);
    },
    keys: async () => [...entries.keys()],
    remove: async (key) => {
      entries.delete(key);
    },
  };
}

describe('sendJson', () => {
  /** A fetch that records the request and answers once. */
  function once(response: Response) {
    const seen: Array<{ method?: string; body?: unknown; headers?: Record<string, string> }> = [];
    const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
      seen.push({
        method: init?.method,
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
        headers: (init?.headers ?? {}) as Record<string, string>,
      });
      return response;
    }) as unknown as typeof fetch;
    return { seen, fetchImpl };
  }

  test('a write is never conditional and never cached', async () => {
    const { seen, fetchImpl } = once(new Response(JSON.stringify({ ok: 1 }), { status: 201 }));
    const result = await sendJson({
      url: 'https://api.example/x',
      method: 'POST',
      body: { a: 1 },
      headers: { authorization: 'Bearer x' },
      fetchImpl,
    });
    expect(result).toEqual({ ok: true, value: { ok: 1 }, status: 201 });
    expect(seen[0].method).toBe('POST');
    expect(seen[0].body).toEqual({ a: 1 });
    expect(seen[0].headers?.['if-none-match']).toBeUndefined();
    expect(seen[0].headers?.['content-type']).toBe('application/json');
  });

  test('204 is a success with no body', async () => {
    const { fetchImpl } = once(new Response(null, { status: 204 }));
    expect(await sendJson({ url: 'u', method: 'PUT', body: {}, fetchImpl })).toEqual({
      ok: true,
      value: null,
      status: 204,
    });
  });

  test('a 200 whose body is not JSON is still a success', async () => {
    const { fetchImpl } = once(new Response('<html>', { status: 200 }));
    expect(await sendJson({ url: 'u', method: 'POST', body: {}, fetchImpl })).toEqual({
      ok: true,
      value: null,
      status: 200,
    });
  });

  test('a refusal carries the host wording', async () => {
    const { fetchImpl } = once(new Response('{}', { status: 403 }));
    const result = await sendJson({
      url: 'u',
      method: 'POST',
      body: {},
      headers: { authorization: 'Bearer x' },
      fetchImpl,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(403);
    expect(result.message).toContain('scope');
  });

  test('an unreachable host is reported, never thrown', async () => {
    const fetchImpl = (async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
    const result = await sendJson({ url: 'u', method: 'POST', body: {}, fetchImpl });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('ECONNREFUSED');
  });
});

describe('invalidateWhere', () => {
  test('drops exactly the entries the predicate names, and prunes orphans', async () => {
    const cache = memoryCache();
    const write = (url: string) =>
      cache.write(cacheKey(url), { url, etag: null, lastModified: null, value: {}, at: 1 });
    await write('https://api.example/repos/o/n/issues');
    await write('https://api.example/repos/o/n/pulls/1');
    await write('https://api.example/repos/other/repo/issues');
    cache.entries.set('orphan', { url: '', etag: null, lastModified: null, value: {}, at: 0 });

    const dropped = await invalidateWhere(cache, (url) => url.includes('/repos/o/n'));
    expect(dropped).toBe(2);
    expect(cache.entries.has(cacheKey('https://api.example/repos/other/repo/issues'))).toBe(true);
    expect(cache.entries.has('orphan')).toBe(false);
  });
});

