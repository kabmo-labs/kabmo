/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The credential-removal endpoint. Its whole reason for existing is that
 * `disableProvider`/`disconnect` only hide a provider — the secret stays on
 * disk — so the two commands it drives must be `get_logout_accounts` (read the
 * removable accounts) and `logout` (remove one), and a malformed omp reply must
 * yield an empty list rather than a fabricated account.
 */

import { describe, expect, test } from 'bun:test';

import { logoutAction } from '@/server/routes/settings/provider-logout';

function post(body: unknown): Request {
  return new Request('http://localhost/api/settings/providers/logout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/settings/providers/logout', () => {
  test('a missing providerId is refused', async () => {
    const res = await logoutAction({ request: post({}), params: {} } as never);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'providerId is required' });
  });

  test('a non-POST verb is refused', async () => {
    const request = new Request('http://localhost/api/settings/providers/logout', { method: 'GET' });
    const res = await logoutAction({ request, params: {} } as never);
    expect(res.status).toBe(405);
  });
});
