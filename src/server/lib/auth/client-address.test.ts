/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Which address the login throttle keys on.
 *
 * Two failures are being prevented, and they point in opposite directions:
 *
 * - trusting `x-forwarded-for` from a DIRECT remote connection lets one attacker
 *   present a fresh identity per guess and walk through the budget;
 * - ignoring it behind a tunnel makes every client share `127.0.0.1`, so ten
 *   failures from anywhere lock the owner out for fifteen minutes.
 *
 * The socket address is what separates the two cases, so that is what these
 * tests vary.
 */

import { describe, expect, test } from 'bun:test';
import { effectiveClientAddress } from '@/server/lib/auth/client-address';
import { UNKNOWN_CLIENT_KEY } from '@/server/lib/auth/rate-limit';

function request(headers: Record<string, string> = {}): Request {
  return new Request('http://localhost:3000/api/auth/login', { method: 'POST', headers });
}

describe('effectiveClientAddress', () => {
  test('uses the socket address for a direct remote connection', () => {
    const address = effectiveClientAddress(request({ 'x-forwarded-for': '1.2.3.4' }), '192.168.18.50');
    expect(address).toBe('192.168.18.50');
  });

  test('uses the forwarded address when the socket is loopback', () => {
    const address = effectiveClientAddress(request({ 'x-forwarded-for': '203.0.113.9' }), '127.0.0.1');
    expect(address).toBe('203.0.113.9');
  });

  test('takes the first entry of a forwarded chain', () => {
    const address = effectiveClientAddress(
      request({ 'x-forwarded-for': '203.0.113.9, 10.0.0.1, 127.0.0.1' }),
      '::1',
    );
    expect(address).toBe('203.0.113.9');
  });

  test('keeps loopback when a tunnel sent no forwarded header', () => {
    expect(effectiveClientAddress(request(), '127.0.0.1')).toBe('127.0.0.1');
  });

  test('falls back to the shared unknown key when there is no socket address', () => {
    expect(effectiveClientAddress(request({ 'x-forwarded-for': '203.0.113.9' }), undefined)).toBe(UNKNOWN_CLIENT_KEY);
  });

  test('treats an empty forwarded value as absent', () => {
    expect(effectiveClientAddress(request({ 'x-forwarded-for': '   ' }), '127.0.0.1')).toBe('127.0.0.1');
  });
});
