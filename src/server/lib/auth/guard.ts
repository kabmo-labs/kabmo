/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The UI-auth gate: one `onBeforeHandle` in front of every route.
 *
 * Registered on the root Elysia instance BEFORE `routes/index.ts` is mounted,
 * which is what makes it cover the whole surface at once — REST handlers, the
 * SSE streams, and the `.ws()` routes a domain plugin registers internally.
 * (Verified against Elysia 1.4.30: a hook added after `.use()` never runs, and a
 * hook added before it runs for the child's own `ws` `beforeHandle` too.)
 *
 * Two paths cannot be covered from here and are handled elsewhere:
 *
 * - `/_shell` lives in `Bun.serve`'s own routing table rather than Elysia's, so
 *   no hook sees it. It is left reachable deliberately: it serves the page
 *   skeleton and, measured, carries no bootstrap payload — the settings map is
 *   injected by the SSR route, which is gated.
 * - Static assets are exempt by necessity: the login page is the app shell, so
 *   its bundle, stylesheet and fonts must load before any credential exists.
 *
 * The config is read once and cached. A password change goes through
 * `POST /api/auth/password`, which invalidates the cache — so a change takes
 * effect on the next request without a restart.
 */

import { hashPassword, deriveCredentialKey, readSessionSecret, writeSessionSecret, type ActiveAuthConfig } from '@/server/lib/auth/config';
import { readSessionCookie, verifySessionToken } from '@/server/lib/auth/token';
import { rememberClientAddress } from '@/server/lib/auth/client-address';
import type { CredentialHandover } from '@/shared/lib/auth/handover';

/**
 * The login screen's path. One constant because three places depend on the same
 * string agreeing: it is public (the way in), it is where an unauthenticated
 * document request is sent, and it is where a signed-in visitor must NOT stay.
 */
const LOGIN_PATH = '/login';

/** Paths that never require a session, because they ARE the way in. */
const PUBLIC_EXACT = new Set([
  '/api/health',
  '/api/auth/state',
  '/api/auth/login',
  '/api/auth/logout',
  LOGIN_PATH,
  '/robots.txt',
  '/sw.js',
  '/manifest.webmanifest',
  '/favicon.ico',
  '/fonts.css',
  '/_shell',
]);

/**
 * Prefixes whose contents are the app itself: bundle, styles, fonts, icons.
 *
 * Each ends at a real separator — `/fonts/`, `/icon.` — rather than at a word
 * stem. A bare `/icon` would also exempt `/icons-secret`, and a public prefix
 * that matches more than it names is an open door that nothing reports.
 */
const PUBLIC_PREFIXES = [
  '/_bun/',
  '/_dev-assets/',
  '/fonts/',
  '/static/',
  '/.well-known/',
  // The icons are served both by their stable names (`/icon.svg`, referenced
  // absolutely from the manifest, which Bun does not rewrite) and by the hashed
  // names the HTML loader emits for the ones `index.html` links.
  '/icon.',
  '/icon-',
  '/apple-touch-icon.',
  '/apple-touch-icon-',
];

/** True when `pathname` is reachable without a session. */
export function isPublicPath(pathname: string): boolean {
  if (PUBLIC_EXACT.has(pathname)) return true;
  for (const prefix of PUBLIC_PREFIXES) {
    if (pathname.startsWith(prefix)) return true;
  }
  return false;
}

/**
 * The auth state of this process, or null when authentication is off.
 *
 * A module-level slot, populated ONCE by `initAuth()` before the listener opens.
 * There is nothing to re-read per request, and nothing on disk that could turn
 * authentication on behind the operator's back — which is the whole point of the
 * design. `initAuth` is the only writer.
 */
let active: ActiveAuthConfig | null = null;

/**
 * arm authentication for this process from a password supplied on the command
 * line or in the environment. Call once, before the listener opens.
 *
 * Returns a description of the outcome for the boot banner. The hash is computed
 * here and never leaves the process; only the session secret is persisted, so a
 * restart keeps its sessions without keeping the password.
 */
export async function initAuth(password: string | null | undefined): Promise<string> {
  const candidate = typeof password === 'string' ? password.trim() : '';
  if (candidate.length === 0) {
    active = null;
    return 'disabled (no --ui-password or OMPCHAMBER_UI_PASSWORD given)';
  }

  const existingSecret = await readSessionSecret();
  const sessionSecret = existingSecret ?? crypto.randomUUID();
  // Written only when it is new, so a normal restart does not touch the file.
  if (!existingSecret) await writeSessionSecret(sessionSecret);

  active = {
    passwordHash: await hashPassword(candidate),
    // Derived, not hashed: this is the half that has to come out the SAME on
    // the next boot, which is what makes a restart keep its sessions.
    credentialKey: deriveCredentialKey(candidate, sessionSecret),
    sessionSecret,
  };
  return existingSecret
    ? 'enabled (password from this run)'
    : 'enabled (password from this run; new session secret generated)';
}

/**
 * Arm authentication from a credential a PREVIOUS process already hashed.
 *
 * This is the self-restart path. The replacement is spawned by
 * `ompchamber restart`, which never had the plaintext — the server that armed
 * the restart did, and it has already hashed it. Handing the hash over instead
 * of the password is what keeps the plaintext from being respawned at all: a
 * `--ui-password` given to the original run never has to exist again, and the
 * sessions it signed stay valid because the credential key and the secret it
 * was derived from travel together.
 *
 * The secret is used as given rather than re-read from disk: if the file were
 * unreadable, reading it would mint a new secret, compute a different key, and
 * sign every session out on a restart the user did not ask for.
 */
export async function initAuthFromHandover(handover: CredentialHandover): Promise<string> {
  if (!handover.passwordHash || !handover.credentialKey || !handover.sessionSecret) {
    return initAuth(handover.password);
  }
  const existingSecret = await readSessionSecret();
  if (existingSecret !== handover.sessionSecret) await writeSessionSecret(handover.sessionSecret);
  active = {
    passwordHash: handover.passwordHash,
    credentialKey: handover.credentialKey,
    sessionSecret: handover.sessionSecret,
  };
  return 'enabled (credential handed over by the restarting instance)';
}

/**
 * Replace the active password at runtime — the `POST /api/auth/password` path.
 *
 * The session secret is deliberately REUSED, so a password change does not sign
 * the user out of this browser. It does revoke every OTHER session, because a
 * token carries a fingerprint of the credential key and that just changed.
 */
export async function replaceActivePassword(password: string): Promise<void> {
  const sessionSecret = active?.sessionSecret ?? (await readSessionSecret()) ?? crypto.randomUUID();
  if (!active) await writeSessionSecret(sessionSecret);
  active = {
    passwordHash: await hashPassword(password),
    credentialKey: deriveCredentialKey(password, sessionSecret),
    sessionSecret,
  };
}

/**
 * Revoke every session everywhere, by rotating the signing secret.
 *
 * A session token is stateless — an HMAC over its expiry and a fingerprint of
 * the password hash — so there is no list of issued tokens to walk and mark
 * dead. Rotating the secret is what makes every existing token fail
 * verification at once, which is the only revocation a stateless design has, and
 * it is the stronger form: a copied cookie dies with the rest.
 *
 * The new secret is persisted, so the revocation survives a restart. If the
 * write fails the rotation still applies to this process, which is the useful
 * half — the caller is told so it can say the revocation is temporary.
 */
export async function revokeAllSessions(): Promise<{ revoked: boolean; persisted: boolean }> {
  const nextSecret = crypto.randomUUID();
  const persisted = await writeSessionSecret(nextSecret);
  // Keep the current password hash: the user asked to end sessions, not to
  // change their password.
  if (active) active = { ...active, sessionSecret: nextSecret };
  return { revoked: true, persisted };
}

/**
 * The active config, or null when authentication is off.
 *
 * Synchronous by design: the value is settled before the first request, so a
 * handler cannot observe a half-initialised state, and there is no per-request
 * I/O to fail.
 */
export function loadAuthConfig(): ActiveAuthConfig | null {
  return active;
}

/**
 * Whether UI auth is active for this run. Read by the health endpoint and the CLI.
 */
export function isAuthEnabled(): boolean {
  return active !== null;
}

/**
 * Whether this request carries a valid session.
 *
 * A request with no active config is authenticated by definition — there is
 * nothing to check it against — so callers that need to distinguish "no
 * password required" from "valid session" must consult `isAuthEnabled()` first.
 */
export function isAuthenticatedRequest(request: Request): boolean {
  if (!active) return true;
  return verifySessionToken(readSessionCookie(request), {
    sessionSecret: active.sessionSecret,
    credentialKey: active.credentialKey,
  });
}

/** JSON body for a rejected API call, or a redirect for a document request. */
function rejectionResponse(pathname: string, wantsHtml: boolean): Response {
  if (wantsHtml || !pathname.startsWith('/api/')) {
    // The login screen is the shell itself, so a document request is sent there
    // rather than answered with a body it could not render.
    return new Response(null, { status: 302, headers: { location: LOGIN_PATH, 'cache-control': 'no-store' } });
  }
  return new Response(JSON.stringify({ error: 'UI authentication required', locked: true }), {
    status: 401,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

/**
 * The gate itself. Returns a `Response` to reject, or `undefined` to continue.
 *
 * `clientAddress` comes from the socket (Elysia's `server.requestIP`) and is
 * recorded for the login route, which throttles by it. It is optional so a test
 * can exercise the gate without a listener.
 *
 * Preflight is passed through: an `OPTIONS` carries no credentials by design and
 * the routes that matter are same-origin, so rejecting it would only break
 * browsers that probe.
 */
export function authGate(request: Request, clientAddress?: string): Response | undefined {
  if (request.method === 'OPTIONS') return undefined;

  rememberClientAddress(request, clientAddress);

  const pathname = new URL(request.url).pathname;

  // The login screen is for someone who has no session. A visitor who already
  // has one — a bookmarked `/login`, a stale tab, a hand-typed address, or the
  // back button after signing in — is sent to the app instead of being shown a
  // form that would only re-authenticate what it already is.
  //
  // Checked BEFORE the public-path shortcut, because that shortcut is what used
  // to let `/login` render the workspace at a URL that says otherwise. It also
  // covers the case where authentication is off entirely, where there is
  // nothing to log into at all.
  if (pathname === LOGIN_PATH && isAuthenticatedRequest(request)) {
    return new Response(null, { status: 302, headers: { location: '/', 'cache-control': 'no-store' } });
  }

  if (isPublicPath(pathname)) return undefined;

  if (!active) return undefined;

  const token = readSessionCookie(request);
  if (verifySessionToken(token, { sessionSecret: active.sessionSecret, credentialKey: active.credentialKey })) {
    return undefined;
  }

  const wantsHtml = (request.headers.get('accept') ?? '').includes('text/html');
  return rejectionResponse(pathname, wantsHtml);
}
