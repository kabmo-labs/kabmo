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
 * This is the socket address, never `x-forwarded-for` — that header is
 * caller-supplied, so a rate limit keyed on it would be trivially evaded.
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

/** Record the socket address for `request`. Called by the auth gate. */
export function rememberClientAddress(request: Request, address: string | undefined): void {
  addresses.set(request, address && address.length > 0 ? address : UNKNOWN_CLIENT_KEY);
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
