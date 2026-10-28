/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * `GET /api/auth/state` — whether a password is required, and whether THIS
 * request carries a valid session.
 *
 * Public by necessity: the client asks before it has a session, and the answer
 * is the only thing that tells it whether to render the login screen or the app.
 * It therefore reports two booleans and nothing else — no version, no hint about
 * the password, no session detail.
 */

import { json, NO_STORE_HEADERS } from '@/server/lib/remix-compat';
import type { LoaderFunctionArgs } from '@/server/lib/remix-compat';
import { loadAuthConfig } from '@/server/lib/auth/guard';
import { readSessionCookie, verifySessionToken } from '@/server/lib/auth/token';

export async function loader({ request }: LoaderFunctionArgs) {
  const config = loadAuthConfig();

  if (!config) {
    return json({ required: false, authenticated: true }, { headers: NO_STORE_HEADERS });
  }

  const authenticated = verifySessionToken(readSessionCookie(request), {
    sessionSecret: config.sessionSecret,
    credentialKey: config.credentialKey,
  });

  return json({ required: true, authenticated }, { headers: NO_STORE_HEADERS });
}
