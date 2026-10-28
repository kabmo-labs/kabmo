/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The fake host both adapter suites read through.
 *
 * A live forge cannot be part of a test: it needs a credential, a network and a
 * repository that does not change. So the mapping is driven against the exact
 * JSON each vendor documents, through a fetch that answers from a table — which
 * is the only part of an adapter that can be wrong, because the fetching is
 * `http.ts`'s own subject.
 *
 * Shared rather than copied: two implementations of the envelope shape would
 * let one suite pass while the other described a host that does not exist.
 */

import type { CachedResponse, JsonCache } from './http';

/** A cache that never hits, so every read goes to the fake fetch. */
export function coldCache(): JsonCache {
  const entries = new Map<string, CachedResponse>();
  return {
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

/** A fetch that answers from a path → body table and records the URLs asked. */
export function host(table: Record<string, unknown | { status: number }>) {
  const asked: string[] = [];
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = String(input);
    asked.push(url);
    const path = url.replace(/^https?:\/\/[^/]+/, '').split('?')[0];
    const body = table[path];
    if (body === undefined) return new Response('{}', { status: 404 });
    if (typeof body === 'object' && body !== null && 'status' in body && typeof body.status === 'number') {
      return new Response('{}', { status: body.status });
    }
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { asked, fetchImpl };
}
