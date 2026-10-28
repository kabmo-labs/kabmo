/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * "Did this request come from a page this console served?"
 *
 * One rule with two callers, because the two need it for the same reason: a
 * browser will happily send a cross-origin request to `localhost`, and a
 * request that LOOKS like a normal one can still make this machine do work.
 *
 * - **A WebSocket upgrade** (`isSameOriginUpgrade`): no preflight protects an
 *   upgrade, so without the check a cross-origin page could drive the terminal
 *   PTY or trigger dictation's model download.
 * - **A mutating route with a lasting side effect** (`isSameOriginRequest`): a
 *   `no-cors` POST reaches localhost without the page reading the answer, which
 *   is enough for a request whose point is the EFFECT — `POST /api/fs/grant`
 *   widens what the console may read.
 *
 * Requests without an Origin — curl, a test, a native shell's own HTTP client —
 * are allowed: they are not a browser being tricked into dialing localhost.
 */
export function isSameOriginUpgrade(request: Request): boolean {
  return isSameOriginRequest(request);
}

/**
 * The same test, for an ordinary request.
 *
 * A mutating route that changes what the console may READ needs it too: a
 * cross-origin page can fire a `no-cors` POST at localhost without reading the
 * answer, and a grant registered as a side effect would be live for every
 * same-origin caller afterwards. The check is the `Origin` header, which a
 * browser sets on every cross-origin POST and cannot be forged from a page.
 */
export function isSameOriginRequest(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  const host = request.headers.get('host');
  if (!host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
