/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The conditional read, over a fake host.
 *
 * The property that matters is the one the panel depends on: a second read of an
 * unchanged resource must not cost a body, and a changed one must replace what is
 * cached. Both are invisible against a live host (the second read looks the same
 * either way) and both are wrong in a way nothing reports.
 */

import { describe, expect, test } from 'bun:test';

import type { PluginJson } from '@kabmo-labs/kabmo-sdk';
import {
  authHeaders,
  cacheKey,
  describeFailure,
  getJson,
  isAuthenticated,
  kvCache,
  type CachedResponse,
  type JsonCache,
} from './http';

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

/** A fetch that records what it was asked and answers from a table. */
function recorder(responses: Response[]) {
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), headers: (init?.headers ?? {}) as Record<string, string> });
    const next = responses.shift();
    if (!next) throw new Error('no more responses');
    return next;
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

function json(body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

describe('getJson', () => {
  test('stores the payload and its validator', async () => {
    const cache = memoryCache();
    const { fetchImpl } = recorder([json({ issues: [1] }, { etag: 'W/"abc"' })]);

    const first = await getJson({ cache, url: 'https://api.example/issues', fetchImpl });
    expect(first).toEqual({ ok: true, value: { issues: [1] }, cached: false });
    expect(cache.entries.get(cacheKey('https://api.example/issues'))?.etag).toBe('W/"abc"');
  });

  test('a second read is conditional, and a 304 returns the cached payload', async () => {
    const cache = memoryCache();
    const { calls, fetchImpl } = recorder([
      json({ issues: [1] }, { etag: 'W/"abc"' }),
      new Response(null, { status: 304 }),
    ]);

    await getJson({ cache, url: 'https://api.example/issues', fetchImpl });
    const second = await getJson({ cache, url: 'https://api.example/issues', fetchImpl });

    expect(calls[1].headers['if-none-match']).toBe('W/"abc"');
    expect(second).toEqual({ ok: true, value: { issues: [1] }, cached: true });
  });

  test('a changed body replaces what is cached', async () => {
    const cache = memoryCache();
    const { fetchImpl } = recorder([
      json({ issues: [1] }, { etag: 'W/"a"' }),
      json({ issues: [1, 2] }, { etag: 'W/"b"' }),
    ]);

    await getJson({ cache, url: 'https://api.example/issues', fetchImpl });
    const second = await getJson({ cache, url: 'https://api.example/issues', fetchImpl });

    expect(second).toEqual({ ok: true, value: { issues: [1, 2] }, cached: false });
    expect(cache.entries.get(cacheKey('https://api.example/issues'))?.etag).toBe('W/"b"');
  });

  test('one URL does not answer for another', async () => {
    const cache = memoryCache();
    const { calls, fetchImpl } = recorder([json({ a: 1 }), json({ b: 2 })]);

    await getJson({ cache, url: 'https://api.example/a', fetchImpl });
    const second = await getJson({ cache, url: 'https://api.example/b', fetchImpl });

    expect(calls[1].headers['if-none-match']).toBeUndefined();
    expect(second).toEqual({ ok: true, value: { b: 2 }, cached: false });
  });

  test('a 401 names the token, not the status', async () => {
    const cache = memoryCache();
    const { fetchImpl } = recorder([new Response('{}', { status: 401 })]);
    const result = await getJson({ cache, url: 'https://api.example/x', fetchImpl });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(401);
    expect(result.message).toContain('token');
  });

  test('a rate-limited 403 says when to retry', async () => {
    const cache = memoryCache();
    const reset = String(Math.floor(Date.now() / 1000) + 600);
    const { fetchImpl } = recorder([
      new Response('{}', { status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': reset } }),
    ]);
    const result = await getJson({ cache, url: 'https://api.example/x', fetchImpl });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('Rate limit');
    expect(result.message).toContain('Try again after');
  });

  test('an unreachable host is reported, never thrown', async () => {
    const cache = memoryCache();
    const fetchImpl = (async () => {
      throw new Error('connect ECONNREFUSED');
    }) as unknown as typeof fetch;
    const result = await getJson({ cache, url: 'https://api.example/x', fetchImpl });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('ECONNREFUSED');
  });

  test('a body that is not JSON is reported', async () => {
    const cache = memoryCache();
    const { fetchImpl } = recorder([new Response('<html>', { status: 200 })]);
    const result = await getJson({ cache, url: 'https://api.example/x', fetchImpl });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('not JSON');
  });

  test('the cache is bounded, and the oldest entry is what goes', async () => {
    const cache = memoryCache();
    let clock = 1_000;
    const now = () => clock;
    // 61 distinct URLs crosses the 60-entry ceiling.
    for (let index = 0; index < 61; index += 1) {
      clock += 1;
      const { fetchImpl } = recorder([json({ index })]);
      await getJson({ cache, url: `https://api.example/${index}`, fetchImpl, now });
    }

    expect(cache.entries.size).toBeLessThan(61);
    expect(cache.entries.has(cacheKey('https://api.example/0'))).toBe(false);
    expect(cache.entries.has(cacheKey('https://api.example/60'))).toBe(true);
  });
});

describe('authHeaders', () => {
  test('each provider gets its own credential header', () => {
    expect(authHeaders('github', 'ghp_x')).toEqual({
      authorization: 'Bearer ghp_x',
      'x-github-api-version': '2022-11-28',
    });
    expect(authHeaders('gitlab', 'glpat-x')).toEqual({ 'private-token': 'glpat-x' });
    expect(authHeaders('gitea', 'abc')).toEqual({ authorization: 'token abc' });
    expect(authHeaders('github', null)).toEqual({});
  });

  test('Bitbucket tells an app password from an access token', () => {
    expect(authHeaders('bitbucket', 'access-token')).toEqual({ authorization: 'Bearer access-token' });
    // An app password is a user/password pair, and Basic is the only header the
    // host accepts for it — sent as Bearer it answers 401 and reads as a bad
    // token.
    expect(authHeaders('bitbucket', 'user:app-pass')).toEqual({
      authorization: `Basic ${Buffer.from('user:app-pass').toString('base64')}`,
    });
  });
});

describe('isAuthenticated', () => {
  test('any of the two header spellings counts', () => {
    expect(isAuthenticated({ authorization: 'Bearer x' })).toBe(true);
    expect(isAuthenticated({ 'private-token': 'x' })).toBe(true);
    expect(isAuthenticated({})).toBe(false);
    expect(isAuthenticated(undefined)).toBe(false);
  });
});

describe('describeFailure', () => {
  test('404 explains the two reasons a repository is invisible', () => {
    expect(describeFailure(new Response(null, { status: 404 }), false)).toContain('private');
    expect(describeFailure(new Response(null, { status: 404 }), true)).toContain('token');
  });

  test('a 403 to an ANONYMOUS read is not advice about a token scope', () => {
    const anonymous = describeFailure(new Response(null, { status: 403 }), false);
    expect(anonymous).toContain('anonymous');
    expect(anonymous).not.toContain('may not have scope');

    const authenticated = describeFailure(new Response(null, { status: 403 }), true);
    expect(authenticated).toContain('scope');
  });

  test('a rate-limited 403 wins over the anonymous wording', () => {
    const message = describeFailure(
      new Response(null, { status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '9999999999' } }),
      false,
    );
    expect(message).toContain('Rate limit');
  });

  test('an unknown status still says which one', () => {
    expect(describeFailure(new Response(null, { status: 500 }), true)).toContain('500');
  });
});

describe('kvCache', () => {
  test('round-trips through the plugin store shape', async () => {
    const store = new Map<string, PluginJson>();
    const cache = kvCache({
      read: async <T,>(key: string) => store.get(key) as T | undefined,
      write: async (key, value) => {
        store.set(key, value);
      },
      keys: async () => [...store.keys()],
      remove: async (key) => {
        store.delete(key);
      },
    });
    const entry: CachedResponse = {
      url: 'u',
      etag: null,
      lastModified: null,
      value: { ok: 1 },
      at: 5,
    };
    await cache.write('k', entry);
    expect(await cache.read('k')).toEqual(entry);
    expect(await cache.keys()).toEqual(['k']);
    await cache.remove('k');
    expect(await cache.read('k')).toBeUndefined();
  });
});
