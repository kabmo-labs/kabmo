/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The caller's socket address, captured by the auth gate for the login route.
 *
 * The address is only reachable from Elysia's handler context (`server.requestIP`),
 * which the ported route modules never receive — they get `{ request, params }`
 * and nothing else. The gate runs before every handler and does receive it, so it
 * records the address against the `Request` object and the login route reads it
 * back.
 *
 * A `WeakMap` keyed by the `Request` is safe here specifically because the gate
 * and the handler are handed the SAME object (verified on Elysia 1.4.30). It is
 * also self-cleaning: the entry disappears with the request.
 *
 * ## Why `x-forwarded-for` is read, and only from loopback
 *
 * The header is caller-supplied, so a rate limit keyed on it unconditionally is
 * trivially evaded — that was the original rule, and it is still right for a
 * direct connection. But a tunnel breaks the other way: `cloudflared` and
 * `tailscale serve` both connect to this server from `127.0.0.1`, so EVERY
 * client behind a tunnel shares one socket address. Ten failed logins from an
 * attacker anywhere on the internet then locked the owner out for fifteen
 * minutes — a denial of service against the person the limit exists to protect.
 *
 * The condition is therefore the socket, not the header: the forwarded value is
 * used only when the connection itself came from loopback. A remote attacker
 * cannot make their own socket address loopback, and a local process that can
 * forge the header already has the machine.
 *
 * NOTE: there is deliberately no `clientAddressFromContext(context)` here.
 *
 * One existed, and calling it from the auth hook made every POST arrive with an
 * already-consumed body — `request.bodyUsed === true` before any handler ran, so
 * the login route parsed an empty body and rejected a correct password.
 *
 * Measured on Bun 1.4.2 + Elysia 1.4.30: `authGate(c.request,
 * clientAddressFromContext(c))` lost the body, while the identical logic written
 * inline kept it, and the same held for a helper whose entire body was
 * `'request' in c` — the trigger is handing this context to any function, not
 * the logic inside it. `src/server/index.ts` therefore reads `server.requestIP`
 * inline. This module keeps only the WeakMap half, which is reached from a plain
 * `Request` and is unaffected.
 */

import { UNKNOWN_CLIENT_KEY } from '@/server/lib/auth/rate-limit';

const addresses = new WeakMap<Request, string>();

/** Whether a socket address is this machine talking to itself. */
function isLoopback(address: string): boolean {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

/**
 * The address a rate limit should key on.
 *
 * Behind a tunnel the socket is loopback for every client, so the forwarded
 * value is the only thing that distinguishes them. It is trusted ONLY in that
 * case — see the module comment for why the socket, not the header, is the
 * condition.
 */
export function effectiveClientAddress(request: Request, socketAddress: string | undefined): string {
  if (!socketAddress) return UNKNOWN_CLIENT_KEY;
  if (!isLoopback(socketAddress)) return socketAddress;
  const forwarded = request.headers.get('x-forwarded-for');
  if (!forwarded) return socketAddress;
  const first = forwarded.split(',')[0]?.trim();
  return first || socketAddress;
}

/** Record the socket address for `request`. Called by the auth gate. */
export function rememberClientAddress(request: Request, address: string | undefined): void {
  addresses.set(request, effectiveClientAddress(request, address));
}

/**
 * The socket address recorded for `request`, or the shared unknown-client key.
 *
 * Falling back to a single shared key (rather than to per-request randomness)
 * is what keeps an unidentifiable caller throttled: they draw from the small
 * shared budget instead of getting a fresh one.
 */
export function clientAddressFor(request: Request): string {
  return addresses.get(request) ?? UNKNOWN_CLIENT_KEY;
}
