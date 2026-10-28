/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * `POST /api/auth/logout` — clear this browser's session cookie.
 *
 * Public by design: signing out must work with an expired or already-invalid
 * session, which is exactly the state a client reaches when its cookie was
 * issued by a previous password. It clears the slot for THIS host:port, so
 * signing out of one instance never signs the user out of another.
 *
 * Only the cookie is cleared. The token itself stays cryptographically valid
 * until it expires — revoking it for real is what changing the password does,
 * because every token carries a fingerprint of the password hash.
 */

import { json, NO_STORE_HEADERS } from '@/server/lib/remix-compat';
import type { ActionFunctionArgs } from '@/server/lib/remix-compat';
import { methodNotAllowed } from '@/server/lib/route-adapter';
import { clearSessionCookieHeader, isSecureRequest, sessionCookieName } from '@/server/lib/auth/token';

export async function action({ request, params }: ActionFunctionArgs) {
  if (request.method !== 'POST') return methodNotAllowed({ request, params });

  return json(
    { success: true },
    {
      headers: {
        ...NO_STORE_HEADERS,
        'set-cookie': clearSessionCookieHeader(sessionCookieName(request.headers), isSecureRequest(request)),
      },
    },
  );
}
