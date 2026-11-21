/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The conditional read, which is the only reason a 60-second poll is allowed.
 *
 * A second read of an unchanged resource must send the stored validator and must
 * NOT rewrite the cache; a changed one must replace the body and the validator.
 * A failure must be a sentence the panel can render, not a status code.
 */

import { describe, expect, test } from 'bun:test';

import { cacheKey, describeFailure, getJson, kvCache, type KvLike } from './http';

/** An in-memory `api.storage.kv`, so nothing here touches a plugin store. */
function memoryKv(): KvLike & { entries: Map<string, unknown> } {
  const entries = new Map<string, unknown>();
  return {
    entries,
    read: async <T>(key: string) => entries.get(key) as T | undefined,
    write: async (key, value) => {
      entries.set(key, value);
    },
    remove: async (key) => {
      entries.delete(key);
    },
    keys: async () => [...entries.keys()].sort(),
  };
}

const URL_UNDER_TEST = 'https://api.github.com/repos/kabmo-labs/kabmo/actions/runs?per_page=30';

describe('getJson', () => {
  test('stores the etag with the body, and the next read sends it', async () => {
    const kv = memoryKv();
    const cache = kvCache(kv);
    const seen: Array<Record<string, string>> = [];
    let calls = 0;
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      calls += 1;
      seen.push((init?.headers ?? {}) as Record<string, string>);
      if (calls === 1) {
        return new Response(JSON.stringify({ total_count: 591 }), {
          status: 200,
          headers: { etag: '"abc"', 'content-type': 'application/json' },
        });
      }
      return new Response(null, { status: 304, headers: { etag: '"abc"' } });
    }) as unknown as typeof fetch;

    const first = await getJson({ url: URL_UNDER_TEST, cache, fetchImpl });
    expect(first.ok && first.notModified).toBe(false);
    const second = await getJson({ url: URL_UNDER_TEST, cache, fetchImpl });
    expect(second.ok && second.notModified).toBe(true);
    expect(second.ok && second.value).toEqual({ total_count: 591 });
    expect(seen[1]!['if-none-match']).toBe('"abc"');
  });

  test('a changed body replaces the stored validator', async () => {
    const kv = memoryKv();
    const cache = kvCache(kv);
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return new Response(JSON.stringify({ total_count: calls }), {
        status: 200,
        headers: { etag: `"v${calls}"` },
      });
    }) as unknown as typeof fetch;

    await getJson({ url: URL_UNDER_TEST, cache, fetchImpl });
    const again = await getJson({ url: URL_UNDER_TEST, cache, fetchImpl });
    expect(again.ok && again.value).toEqual({ total_count: 2 });
    const stored = await cache.read(URL_UNDER_TEST);
    expect(stored?.etag).toBe('"v2"');
  });

  test('a refusal is a sentence, and a rate limit says when to retry', async () => {
    const cache = kvCache(memoryKv());
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ message: 'API rate limit exceeded' }), {
        status: 403,
        headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1795181467' },
      })) as unknown as typeof fetch;

    const result = await getJson({ url: URL_UNDER_TEST, cache, fetchImpl });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(403);
      expect(result.message).toContain('Rate limit reached');
      expect(result.message).toContain('Try again after');
    }
  });

  test('an unreachable host is reported, not thrown', async () => {
    const cache = kvCache(memoryKv());
    const fetchImpl = (async () => {
      throw new Error('getaddrinfo ENOTFOUND api.github.com');
    }) as unknown as typeof fetch;
    const result = await getJson({ url: URL_UNDER_TEST, cache, fetchImpl });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('Could not reach GitHub');
  });
});

describe('kvCache.invalidate', () => {
  test('drops only the entries under the prefix a write changed', async () => {
    const kv = memoryKv();
    const cache = kvCache(kv);
    await cache.write({ url: 'https://api.github.com/repos/o/r/actions/runs?per_page=30', etag: 'a', body: {}, at: Date.now() });
    await cache.write({ url: 'https://api.github.com/repos/o/r/actions/runs/1/jobs', etag: 'b', body: {}, at: Date.now() });
    await cache.write({ url: 'https://api.github.com/repos/o/r/pulls', etag: 'c', body: {}, at: Date.now() });

    await cache.invalidate('https://api.github.com/repos/o/r/actions/');

    expect(await cache.read('https://api.github.com/repos/o/r/actions/runs?per_page=30')).toBeUndefined();
    expect(await cache.read('https://api.github.com/repos/o/r/actions/runs/1/jobs')).toBeUndefined();
    expect(await cache.read('https://api.github.com/repos/o/r/pulls')).toBeDefined();
  });

  test('a cache key is stable and bounded', () => {
    const key = cacheKey(URL_UNDER_TEST);
    expect(key).toBe(cacheKey(URL_UNDER_TEST));
    expect(key.length).toBeLessThan(60);
    expect(key).not.toBe(cacheKey(`${URL_UNDER_TEST}&branch=main`));
  });
});

describe('describeFailure', () => {
  const headers = (values: Record<string, string>) => new Headers(values);

  test('an anonymous 403 is about the missing credential, not about scope', () => {
    expect(describeFailure(403, headers({}), false)).toContain('anonymous');
  });

  test('an authenticated 403 is about the token scope', () => {
    expect(describeFailure(403, headers({}), true)).toContain('scope');
  });

  test('a 404 on a public read names the private-repository possibility', () => {
    expect(describeFailure(404, headers({}), false)).toContain('private');
  });

  test('a 401 tells an anonymous reader the endpoint needs a token', () => {
    expect(describeFailure(401, headers({}), false)).toContain('needs a token');
  });
});
