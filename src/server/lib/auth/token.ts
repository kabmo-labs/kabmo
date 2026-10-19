/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Session tokens and the cookie that carries them.
 *
 * A session is a stateless signed value — `v1.<expiresAt>.<fingerprint>.<mac>` —
 * so validating one costs an HMAC and no storage. The middle segment is
 * `HMAC(secret, passwordHash)`: because it is part of the signed payload, every
 * token minted before a password change fails verification afterwards. Changing
 * the password therefore revokes every session, with no session table to sweep.
 *
 * The cookie NAME carries the request port. Browsers key cookies by host and
 * ignore the port (RFC 6265), so two Kabmo instances on one machine share a
 * jar: without the port in the name, logging into the second silently overwrote
 * the first instance's cookie. This install routinely has several ports live at
 * once, so the collision is the normal case rather than an edge one.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

/** Cookie base name; the resolved name appends `_<port>` when the host has one. */
export const SESSION_COOKIE_BASE = 'omp_session';

/** Default session lifetime: 12 hours. */
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

/** Lifetime when the user asks to be remembered on this device: 7 days. */
export const TRUSTED_DEVICE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const TOKEN_VERSION = 'v1';

/**
 * The trailing port of a `Host` authority, or null when there is none.
 * Handles bracketed IPv6 (`[::1]:3000`) and plain host names.
 */
function hostPort(host: string): string | null {
  if (host.startsWith('[')) {
    const end = host.indexOf(']');
    if (end === -1) return null;
    const rest = host.slice(end + 1);
    return rest.startsWith(':') && /^\d+$/.test(rest.slice(1)) ? rest.slice(1) : null;
  }
  const match = host.match(/:(\d+)$/);
  return match ? match[1] : null;
}

/**
 * Cookie name for a request. `x-forwarded-host` wins when present, so an
 * instance behind a reverse proxy is keyed by the port the browser used rather
 * than the upstream one.
 */
export function sessionCookieName(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-host');
  const host = (forwarded ? forwarded.split(',')[0] : headers.get('host') ?? '').trim();
  if (!host) return SESSION_COOKIE_BASE;
  const port = hostPort(host);
  if (!port) return SESSION_COOKIE_BASE;
  const portNumber = Number.parseInt(port, 10);
  return Number.isFinite(portNumber) && portNumber > 0 ? `${SESSION_COOKIE_BASE}_${port}` : SESSION_COOKIE_BASE;
}

/** Read the session token from a request's cookies, or null when absent. */
export function readSessionCookie(request: Request): string | null {
  const header = request.headers.get('cookie');
  if (!header) return null;
  const name = sessionCookieName(request.headers);
  for (const segment of header.split(';')) {
    const index = segment.indexOf('=');
    if (index === -1) continue;
    if (segment.slice(0, index).trim() !== name) continue;
    const value = segment.slice(index + 1).trim();
    if (!value) return null;
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  return null;
}

/**
 * `HMAC(secret, credentialKey)` — the value that binds a session to one password.
 *
 * The key is what `deriveCredentialKey` produces, NOT the argon2 hash: it has to
 * be reproducible from the secret and the password alone, or a session would die
 * with the process that minted it.
 */
export function credentialFingerprint(sessionSecret: string, credentialKey: string): string {
  return createHmac('sha256', sessionSecret).update(credentialKey).digest('base64url');
}

function sign(sessionSecret: string, payload: string): string {
  return createHmac('sha256', sessionSecret).update(payload).digest('base64url');
}

/** Constant-time string comparison that tolerates unequal lengths. */
function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export interface SessionIssueOptions {
  sessionSecret: string;
  /** A `deriveCredentialKey` result — never the argon2 hash (see the field). */
  credentialKey: string;
  ttlMs?: number;
  /** Injected for tests; defaults to now. */
  now?: number;
}

/** Mint a session token valid for `ttlMs`. */
export function issueSessionToken({
  sessionSecret,
  credentialKey,
  ttlMs = SESSION_TTL_MS,
  now = Date.now(),
}: SessionIssueOptions): string {
  const expiresAt = now + ttlMs;
  const payload = [
    TOKEN_VERSION,
    String(expiresAt),
    credentialFingerprint(sessionSecret, credentialKey),
  ].join('.');
  return `${payload}.${sign(sessionSecret, payload)}`;
}

/**
 * True when `token` was minted by this secret for the CURRENT password and has
 * not expired. Every failure mode — malformed, wrong version, bad signature,
 * stale fingerprint, past expiry — is a plain false.
 */
export function verifySessionToken(
  token: string | null | undefined,
  { sessionSecret, credentialKey, now = Date.now() }: Omit<SessionIssueOptions, 'ttlMs'>,
): boolean {
  if (!token) return false;
  const parts = token.split('.');
  if (parts.length !== 4) return false;
  const [version, expiresAt, fingerprint, mac] = parts;
  if (version !== TOKEN_VERSION) return false;
  if (!safeEqual(mac, sign(sessionSecret, `${version}.${expiresAt}.${fingerprint}`))) return false;
  if (!safeEqual(fingerprint, credentialFingerprint(sessionSecret, credentialKey))) return false;
  const expiry = Number(expiresAt);
  return Number.isFinite(expiry) && expiry > now;
}

/**
 * Remaining lifetime of a VALID token, in ms, or null when it is unusable.
 *
 * Reissuing a session (after a password change, after a revocation) has to
 * preserve what the user chose at the login screen. Measured: a 7-day session
 * came back as `Max-Age=43200` after a revoke, because those routes minted a
 * fresh token with the DEFAULT ttl — a silent downgrade from a week to 12 hours
 * that the user could only discover by being signed out early.
 *
 * The deadline is the token's own signed `expiresAt`, so this cannot be talked
 * into extending a session beyond what was issued.
 */
export function sessionRemainingMs(
  token: string | null | undefined,
  { sessionSecret, credentialKey, now = Date.now() }: Omit<SessionIssueOptions, 'ttlMs'>,
): number | null {
  if (!verifySessionToken(token, { sessionSecret, credentialKey, now })) return null;
  // `verifySessionToken` proves the token is a string with a numeric expiry.
  const expiry = Number((token as string).split('.')[1]);
  if (!Number.isFinite(expiry) || expiry <= now) return null;
  return expiry - now;
}

/**
 * `Set-Cookie` value for a session.
 *
 * `SameSite=Lax` rather than `Strict`: this app's own document navigations must
 * keep the cookie (a Strict cookie is withheld on a top-level navigation from
 * another site, which would bounce a returning user through the login screen),
 * while cross-site POSTs still cannot carry it — which is the CSRF exposure that
 * matters here.
 *
 * `Secure` is added only when the request arrived over https. Hardcoding it
 * would make the cookie unsettable on the plain-http localhost this server
 * normally runs on, i.e. login would appear to succeed and never stick.
 */
export function sessionCookieHeader(name: string, token: string, ttlMs: number, secure: boolean): string {
  const maxAge = Math.max(0, Math.floor(ttlMs / 1000));
  const expires = maxAge === 0
    ? 'Thu, 01 Jan 1970 00:00:00 GMT'
    : new Date(Date.now() + maxAge * 1000).toUTCString();
  const attributes = [
    `${name}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
    `Expires=${expires}`,
  ];
  if (secure) attributes.push('Secure');
  return attributes.join('; ');
}

/** `Set-Cookie` value that clears the session cookie. */
export function clearSessionCookieHeader(name: string, secure: boolean): string {
  return sessionCookieHeader(name, '', 0, secure);
}

/** True when the request reached the server over https, directly or via a proxy. */
export function isSecureRequest(request: Request): boolean {
  const forwarded = request.headers.get('x-forwarded-proto');
  if (forwarded) return forwarded.split(',')[0].trim().toLowerCase() === 'https';
  try {
    return new URL(request.url).protocol === 'https:';
  } catch {
    return false;
  }
}
