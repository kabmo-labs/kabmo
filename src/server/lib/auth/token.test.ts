/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Session tokens and the cookie name.
 *
 * The properties pinned here are the ones a change could silently break while
 * every request still "works": a token that outlives its expiry, a token that
 * survives a password change, and a cookie name that collides across ports.
 */

import { describe, expect, test } from 'bun:test';

import {
  clearSessionCookieHeader,
  credentialFingerprint,
  isSecureRequest,
  issueSessionToken,
  readSessionCookie,
  sessionCookieHeader,
  sessionCookieName,
  sessionRemainingMs,
  SESSION_TTL_MS,
  verifySessionToken,
} from '@/server/lib/auth/token';

const SECRET = 'test-secret-value';
const KEY = '$argon2id$v=19$m=65536,t=2,p=1$fakehash';
const NOW = 1_700_000_000_000;

function issue(overrides: Partial<Parameters<typeof issueSessionToken>[0]> = {}): string {
  return issueSessionToken({
    sessionSecret: SECRET,
    credentialKey: KEY,
    now: NOW,
    ...overrides,
  });
}

describe('session tokens', () => {
  test('a freshly issued token verifies', () => {
    const token = issue();
    expect(verifySessionToken(token, { sessionSecret: SECRET, credentialKey: KEY, now: NOW })).toBe(true);
  });

  test('a token expires at its own deadline, not later', () => {
    const token = issue({ ttlMs: 1000 });
    expect(verifySessionToken(token, { sessionSecret: SECRET, credentialKey: KEY, now: NOW + 999 })).toBe(true);
    expect(verifySessionToken(token, { sessionSecret: SECRET, credentialKey: KEY, now: NOW + 1000 })).toBe(false);
    expect(verifySessionToken(token, { sessionSecret: SECRET, credentialKey: KEY, now: NOW + 1001 })).toBe(false);
  });

  test('a changed password revokes every token, because the fingerprint is signed', () => {
    const token = issue();
    const otherKey = '$argon2id$v=19$m=65536,t=2,p=1$differenthash';
    expect(verifySessionToken(token, { sessionSecret: SECRET, credentialKey: otherKey, now: NOW })).toBe(false);
  });

  test('a rotated secret revokes every token', () => {
    const token = issue();
    expect(verifySessionToken(token, { sessionSecret: 'rotated', credentialKey: KEY, now: NOW })).toBe(false);
  });

  test('the payload cannot be edited, because the signature covers all of it', () => {
    const token = issue({ ttlMs: 1000 });
    const [version, expiresAt, fingerprint, mac] = token.split('.');
    const extended = [version, String(Number(expiresAt) + 86_400_000), fingerprint, mac].join('.');
    expect(verifySessionToken(extended, { sessionSecret: SECRET, credentialKey: KEY, now: NOW })).toBe(false);
  });

  test('malformed input is false, never a throw', () => {
    for (const bad of ['', 'v1', 'v1.a.b', 'v1.a.b.c.d', 'v2.1.2.3', null, undefined]) {
      expect(verifySessionToken(bad as string, { sessionSecret: SECRET, credentialKey: KEY, now: NOW })).toBe(false);
    }
  });

  test('the fingerprint differs per password and per secret', () => {
    expect(credentialFingerprint(SECRET, KEY)).not.toBe(credentialFingerprint(SECRET, 'other'));
    expect(credentialFingerprint(SECRET, KEY)).not.toBe(credentialFingerprint('other', KEY));
  });

  test('default TTL is the documented 12 hours', () => {
    const token = issue();
    const expiresAt = Number(token.split('.')[1]);
    expect(expiresAt - NOW).toBe(SESSION_TTL_MS);
  });
});

describe('session cookie name', () => {
  const headersOf = (entries: Record<string, string>) => new Headers(entries);

  test('folds the request port into the name', () => {
    expect(sessionCookieName(headersOf({ host: '192.168.0.1:3000' }))).toBe('omp_session_3000');
    expect(sessionCookieName(headersOf({ host: 'localhost:3001' }))).toBe('omp_session_3001');
  });

  test('keeps the bare name when the host carries no port', () => {
    expect(sessionCookieName(headersOf({ host: '192.168.0.1' }))).toBe('omp_session');
  });

  test('handles bracketed IPv6', () => {
    expect(sessionCookieName(headersOf({ host: '[::1]:3000' }))).toBe('omp_session_3000');
    expect(sessionCookieName(headersOf({ host: '[::1]' }))).toBe('omp_session');
  });

  test('prefers the forwarded host, so a proxy keys by the browser port', () => {
    expect(sessionCookieName(headersOf({ host: '10.0.0.5:8080', 'x-forwarded-host': 'example.test:3000' })))
      .toBe('omp_session_3000');
  });

  test('reads only the slot for this request port', () => {
    const request = new Request('http://localhost:3001/api/settings', {
      headers: { host: 'localhost:3001', cookie: 'omp_session_3000=stale; omp_session_3001=fresh' },
    });
    expect(readSessionCookie(request)).toBe('fresh');
  });

  test('a cookie for another port is not found', () => {
    const request = new Request('http://localhost:3002/api/settings', {
      headers: { host: 'localhost:3002', cookie: 'omp_session_3000=stale' },
    });
    expect(readSessionCookie(request)).toBeNull();
  });
});

describe('behaviour behind a reverse proxy', () => {
  const headersOf = (entries: Record<string, string>) => new Headers(entries);
  const requestTo = (url: string, entries: Record<string, string> = {}) => new Request(url, { headers: entries });

  test('x-forwarded-proto: https makes the cookie Secure', () => {
    // The case that decides whether a Cloudflare tunnel works at all: the
    // browser speaks https while cloudflared forwards plain http to localhost,
    // so the request's own URL says `http:`. Without reading the header the
    // session cookie would be issued without `Secure` on an https site — and a
    // `Secure`-less cookie is what a proxy stripping https would accept.
    const request = requestTo('http://127.0.0.1:3000/login', { 'x-forwarded-proto': 'https' });
    expect(isSecureRequest(request)).toBe(true);
    expect(sessionCookieHeader('omp_session', 'token', SESSION_TTL_MS, isSecureRequest(request))).toContain('Secure');
  });

  test('a plain local request is not Secure', () => {
    // Otherwise the cookie could never be set on the plain-http localhost the
    // server normally runs on.
    expect(isSecureRequest(requestTo('http://127.0.0.1:3000/'))).toBe(false);
  });

  test('only the first forwarded proto counts, as the chain sends it', () => {
    // A chain appends; the client-facing hop is first. A later `http` in the
    // list describes an internal hop, not the browser's connection.
    expect(isSecureRequest(requestTo('http://x/', { 'x-forwarded-proto': 'https, http' }))).toBe(true);
    expect(isSecureRequest(requestTo('http://x/', { 'x-forwarded-proto': 'http, https' }))).toBe(false);
  });

  test('a tunnel host without a port keeps the bare cookie name', () => {
    // A trycloudflare quick tunnel is reached as
    // `https://<name>.trycloudflare.com` — no port — so the name must not gain a
    // suffix that nothing would read back.
    const request = requestTo('http://127.0.0.1:3000/api/settings', {
      host: '127.0.0.1:3000',
      'x-forwarded-host': 'keys-mighty.trycloudflare.com',
    });
    expect(sessionCookieName(request.headers)).toBe('omp_session');
  });

  test('a proxied host WITH a port keeps that port in the name', () => {
    const request = requestTo('http://127.0.0.1:3000/api/settings', {
      host: '127.0.0.1:3000',
      'x-forwarded-host': 'internal.example:8443',
    });
    expect(sessionCookieName(request.headers)).toBe('omp_session_8443');
  });

  test('the cookie is read back with the same name it was issued under', () => {
    // Issuance and validation must agree through a proxy hop, or the browser
    // stores a cookie no request sends.
    const headers = headersOf({ 'x-forwarded-host': 'keys-mighty.trycloudflare.com' });
    const name = sessionCookieName(headers);
    const request = requestTo('http://127.0.0.1:3000/api/settings', {
      'x-forwarded-host': 'keys-mighty.trycloudflare.com',
      cookie: `${name}=the-token`,
    });
    expect(readSessionCookie(request)).toBe('the-token');
  });
});

describe('session cookie attributes', () => {
  test('is HttpOnly and SameSite=Lax, and omits Secure over plain http', () => {
    const header = sessionCookieHeader('omp_session_3000', 'token-value', SESSION_TTL_MS, false);
    expect(header).toContain('HttpOnly');
    expect(header).toContain('SameSite=Lax');
    expect(header).toContain('Path=/');
    expect(header).toContain(`Max-Age=${SESSION_TTL_MS / 1000}`);
    // Secure on an http origin makes the cookie unsettable, i.e. login that
    // appears to succeed and never sticks.
    expect(header).not.toContain('Secure');
  });

  test('adds Secure when the request was https', () => {
    expect(sessionCookieHeader('omp_session_3000', 'token-value', SESSION_TTL_MS, true)).toContain('Secure');
  });

  test('clearing sets Max-Age=0 and an expired date', () => {
    const header = clearSessionCookieHeader('omp_session_3000', false);
    expect(header).toContain('Max-Age=0');
    expect(header).toContain('Expires=Thu, 01 Jan 1970');
  });
});

describe('sessionRemainingMs', () => {
  // Reissuing a session must preserve the lifetime the user chose. Measured:
  // a 7-day session came back as `Max-Age=43200` after a password change,
  // because the route read the TTL from a token that had just stopped verifying.
  test('reports what is left of a valid token', () => {
    const token = issue({ ttlMs: 60_000 });
    expect(sessionRemainingMs(token, { sessionSecret: SECRET, credentialKey: KEY, now: NOW })).toBe(60_000);
    expect(sessionRemainingMs(token, { sessionSecret: SECRET, credentialKey: KEY, now: NOW + 45_000 })).toBe(15_000);
  });

  test('is null for an expired, foreign or missing token', () => {
    const token = issue({ ttlMs: 1_000 });
    expect(sessionRemainingMs(token, { sessionSecret: SECRET, credentialKey: KEY, now: NOW + 1_000 })).toBeNull();
    expect(sessionRemainingMs(token, { sessionSecret: 'other', credentialKey: KEY, now: NOW })).toBeNull();
    expect(sessionRemainingMs(token, { sessionSecret: SECRET, credentialKey: 'other', now: NOW })).toBeNull();
    expect(sessionRemainingMs(null, { sessionSecret: SECRET, credentialKey: KEY, now: NOW })).toBeNull();
    expect(sessionRemainingMs('garbage', { sessionSecret: SECRET, credentialKey: KEY, now: NOW })).toBeNull();
  });

  // The deadline is the token's OWN signed expiry, so this cannot be used to
  // extend a session beyond what was issued.
  test('never exceeds the token\'s own deadline', () => {
    const token = issue({ ttlMs: 5_000 });
    expect(sessionRemainingMs(token, { sessionSecret: SECRET, credentialKey: KEY, now: NOW })).toBe(5_000);
  });
});
