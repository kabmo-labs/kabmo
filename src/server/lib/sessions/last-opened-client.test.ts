/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The client identity behind "last opened session", and why each rule exists.
 *
 * A cookie is the one channel a WebView already persists per app install, so it
 * carries an opaque id rather than a client-supplied key: a caller that could
 * name its own id could read — or overwrite — another install's pointer. The
 * cases below pin the parse (surrounded by other cookies, malformed escapes),
 * the shape guard, and the one response that mints a new identity.
 */

import { describe, expect, test } from 'bun:test';
import {
  CLIENT_COOKIE,
  clientCookieHeader,
  isClientId,
  readClientId,
  resolveClientIdentity,
} from '@/server/lib/sessions/last-opened-client.server';

const ID = '11111111-2222-4333-8444-555555555555';

function requestWithCookie(cookie: string, url = 'http://localhost/'): Request {
  return new Request(url, { headers: { cookie } });
}

describe('readClientId', () => {
  test('finds the id among the other cookies the page sends', () => {
    const request = requestWithCookie(`omp_session_7801=abc; ${CLIENT_COOKIE}=${ID}; theme=dark`);
    expect(readClientId(request)).toBe(ID);
  });

  test('no cookie header, or an empty value, is no identity', () => {
    expect(readClientId(new Request('http://localhost/'))).toBeNull();
    expect(readClientId(requestWithCookie(`${CLIENT_COOKIE}=`))).toBeNull();
  });

  test('a value this server would not mint is refused', () => {
    for (const value of ['short', 'has spaces', 'a'.repeat(65), '../escape']) {
      expect(readClientId(requestWithCookie(`${CLIENT_COOKIE}=${encodeURIComponent(value)}`))).toBeNull();
    }
  });

  test('a malformed escape still answers a decodable value or null', () => {
    expect(readClientId(requestWithCookie(`${CLIENT_COOKIE}=%E0%A4%A`))).toBeNull();
  });
});

describe('isClientId', () => {
  test('accepts the UUID shape it generates and length bounds the rest', () => {
    expect(isClientId(ID)).toBe(true);
    expect(isClientId('a'.repeat(16))).toBe(true);
    expect(isClientId('a'.repeat(15))).toBe(false);
    expect(isClientId('a'.repeat(65))).toBe(false);
    expect(isClientId(undefined)).toBe(false);
  });
});

describe('resolveClientIdentity', () => {
  test('an existing id is reused and no cookie is rewritten', () => {
    const identity = resolveClientIdentity(requestWithCookie(`${CLIENT_COOKIE}=${ID}`));
    expect(identity.clientId).toBe(ID);
    expect(identity.setCookie).toBeNull();
  });

  test('a missing id mints one and returns its cookie', () => {
    const identity = resolveClientIdentity(new Request('http://localhost/'));
    expect(isClientId(identity.clientId)).toBe(true);
    expect(identity.setCookie).toContain(`${CLIENT_COOKIE}=${identity.clientId}`);
  });
});

describe('clientCookieHeader', () => {
  test('is a long-lived, script-invisible cookie scoped to the whole app', () => {
    const header = clientCookieHeader(ID, new Request('http://localhost/'));
    expect(header).toContain(`${CLIENT_COOKIE}=${ID}`);
    expect(header).toContain('Path=/');
    expect(header).toContain('HttpOnly');
    expect(header).toContain('SameSite=Lax');
    expect(header).toContain('Max-Age=31536000');
    expect(header).not.toContain('Secure');
  });

  test('Secure rides only on a TLS request', () => {
    expect(clientCookieHeader(ID, new Request('https://localhost/'))).toContain('Secure');
  });
});
