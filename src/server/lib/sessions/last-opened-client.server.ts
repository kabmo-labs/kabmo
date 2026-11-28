/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The opaque client id that keeps "last opened session" PER INSTALL.
 *
 * A console is one database, but it is not one device: a phone shell, a desktop
 * shell and a browser can all point at the same server, and a single shared
 * pointer made them overwrite each other. Cookie jars are per WebView data
 * store, which is exactly the grain the feature wants — so a random id lives in
 * one cookie and keys the record.
 *
 * The id is not a credential: it names a row in `last_opened_sessions` and
 * nothing else. It is `HttpOnly` because no script needs to read it, and
 * `SameSite=Lax` for the same reason the session cookie uses it — the page's own
 * document navigations must carry it while a cross-site POST must not.
 *
 * The cookie lifetime is deliberately long and independent of the auth session:
 * a device that signs in again is the same install, and "last opened" is about
 * the device, not the login.
 */

import { randomUUID } from 'node:crypto';
import { isSecureRequest } from '@/server/lib/auth/token';

export const CLIENT_COOKIE = 'kabmo_client';

/** One year. A shell that is not opened for longer gets a fresh pointer. */
const CLIENT_COOKIE_TTL_SECONDS = 365 * 24 * 60 * 60;

/** Generated ids are UUIDs; the cap also bounds a forged cookie's DB key. */
const CLIENT_ID_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;

/** Whether an untrusted cookie value is an id this server minted the shape of. */
export function isClientId(value: string | null | undefined): value is string {
  return typeof value === 'string' && CLIENT_ID_PATTERN.test(value);
}

/** The client id this request carries, or null when it has none/invalid. */
export function readClientId(request: Request): string | null {
  const header = request.headers.get('cookie');
  if (!header) return null;
  for (const segment of header.split(';')) {
    const index = segment.indexOf('=');
    if (index === -1) continue;
    if (segment.slice(0, index).trim() !== CLIENT_COOKIE) continue;
    const raw = segment.slice(index + 1).trim();
    if (!raw) return null;
    let value = raw;
    try {
      value = decodeURIComponent(raw);
    } catch {
      // A malformed escape is still a value; the pattern decides.
    }
    return isClientId(value) ? value : null;
  }
  return null;
}

/** `Set-Cookie` for a client id, `Secure` only when the request came over TLS. */
export function clientCookieHeader(clientId: string, request: Request): string {
  const attributes = [
    `${CLIENT_COOKIE}=${encodeURIComponent(clientId)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${CLIENT_COOKIE_TTL_SECONDS}`,
  ];
  if (isSecureRequest(request)) attributes.push('Secure');
  return attributes.join('; ');
}

/**
 * The id to use for this request, and the cookie to send back when it is new.
 *
 * `setCookie` is null when the request already carried a valid id, so a normal
 * navigation never rewrites a year-long cookie.
 */
export function resolveClientIdentity(request: Request): { clientId: string; setCookie: string | null } {
  const existing = readClientId(request);
  if (existing) return { clientId: existing, setCookie: null };
  const clientId = randomUUID();
  return { clientId, setCookie: clientCookieHeader(clientId, request) };
}
