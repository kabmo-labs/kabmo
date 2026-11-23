/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The one copy rule for a failed usage read. A 401 and a 403 are different
 * facts: kiosapi authenticates a valid `sk-` key and then refuses the billing
 * endpoint because the key's group has no permission, so the old shared
 * "rejected the API key" sent the user to rotate a working credential.
 */

import { afterEach, describe, expect, test } from 'bun:test';

import { fetchProviderJson } from '@/server/lib/usage/vendor-http';

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

function respond(status: number, body: unknown = {}): void {
  globalThis.fetch = (async () => new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })) as unknown as typeof fetch;
}

describe('fetchProviderJson status copy', () => {
  test('401 says the key was rejected', async () => {
    respond(401, { error: 'unauthorized' });
    await expect(fetchProviderJson('https://example.test/v1/key', 'sk-x', 'Acme'))
      .rejects.toThrow('Acme rejected the API key (HTTP 401).');
  });

  test('403 says the key is refused for the endpoint, not rejected', async () => {
    respond(403, { error: { message: 'No permission to access group DeepSeek-Discount' } });
    await expect(fetchProviderJson('https://example.test/v1/key', 'sk-x', 'Acme'))
      .rejects.toThrow('Acme refused this endpoint for the key (HTTP 403).');
  });

  test('a 200 body is parsed, and a non-JSON body is named as unreadable', async () => {
    respond(200, { data: { balance: 1 } });
    await expect(fetchProviderJson('https://example.test/v1/key', 'sk-x', 'Acme'))
      .resolves.toEqual({ data: { balance: 1 } });

    globalThis.fetch = (async () => new Response('<html>nope</html>', { status: 200 })) as unknown as typeof fetch;
    await expect(fetchProviderJson('https://example.test/v1/key', 'sk-x', 'Acme'))
      .rejects.toThrow('Acme returned an unreadable balance response.');
  });
});
