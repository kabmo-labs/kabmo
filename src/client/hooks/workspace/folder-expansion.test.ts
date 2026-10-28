/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The one folder-expansion write.
 *
 * Both non-header callers (the phone's toggle and the sidebar's auto-expand)
 * go through it, so what it must get right is the REQUEST: the route's URL, the
 * form body the action reads, and a boolean answer the caller can trust.
 */

import { afterEach, describe, expect, test } from 'bun:test';

import { setFolderExpanded } from '@/client/hooks/workspace/folder-expansion';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

interface Call {
  url: string;
  body: Record<string, string>;
}

/** Answer every request with `status`, recording what was sent. */
function stubFetch(status: number): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const body = init?.body instanceof URLSearchParams
      ? Object.fromEntries(init.body.entries())
      : {};
    calls.push({ url: String(input), body });
    return new Response('{}', { status });
  }) as unknown as typeof fetch;
  return calls;
}

describe('setFolderExpanded', () => {
  test('POSTs the toggle with the flag as form data', async () => {
    const calls = stubFetch(200);

    expect(await setFolderExpanded(7, true)).toBe(true);
    expect(calls).toEqual([{ url: '/api/folders/7/toggle', body: { isExpanded: 'true' } }]);

    expect(await setFolderExpanded(7, false)).toBe(true);
    expect(calls[1]).toEqual({ url: '/api/folders/7/toggle', body: { isExpanded: 'false' } });
  });

  test('reports a refused write instead of claiming it landed', async () => {
    stubFetch(500);
    expect(await setFolderExpanded(7, true)).toBe(false);
  });

  test('reports a request that never reached the server', async () => {
    globalThis.fetch = (() => Promise.reject(new Error('offline'))) as unknown as typeof fetch;
    expect(await setFolderExpanded(7, true)).toBe(false);
  });
});
