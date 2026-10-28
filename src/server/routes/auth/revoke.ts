/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * `POST /api/auth/revoke` — end every session, on every device.
 *
 * This is the "I left a tab open somewhere" button. `POST /api/auth/logout`
 * clears the cookie in the browser that asked; it cannot reach a copy of that
 * cookie held elsewhere, because a session token is stateless and stays valid
 * until it expires. Rotating the signing secret is what actually invalidates the
 * set — see `revokeAllSessions`.
 *
 * Not public: the gate requires a session, so a stranger cannot force a
 * denial-of-service by revoking someone else's logins. The caller gets a fresh
 * cookie for this browser, so revoking everywhere does not log the person doing
 * it out of the page they are looking at.
 */

import { json, NO_STORE_HEADERS } from '@/server/lib/remix-compat';
import type { ActionFunctionArgs } from '@/server/lib/remix-compat';
import { methodNotAllowed } from '@/server/lib/route-adapter';
import { loadAuthConfig, revokeAllSessions } from '@/server/lib/auth/guard';
import { issueSessionToken, isSecureRequest, readSessionCookie, sessionCookieHeader, sessionCookieName, sessionRemainingMs, SESSION_TTL_MS } from '@/server/lib/auth/token';

export async function action({ request, params }: ActionFunctionArgs) {
  if (request.method !== 'POST') return methodNotAllowed({ request, params });

  if (!loadAuthConfig()) {
    return json({ error: 'UI authentication is not enabled' }, { status: 400, headers: NO_STORE_HEADERS });
  }

  // Read BEFORE the rotation: revoking rotates the signing secret, so the
  // presented token stops verifying the moment it happens — reading afterwards
  // always answered "unusable" and fell back to the default, which is how a
  // 7-day session silently became a 12-hour one.
  const before = loadAuthConfig()!;
  const ttlMs = sessionRemainingMs(readSessionCookie(request), {
    sessionSecret: before.sessionSecret,
    credentialKey: before.credentialKey,
  }) ?? SESSION_TTL_MS;

  const { persisted } = await revokeAllSessions();
  const updated = loadAuthConfig();
  if (!updated) {
    return json({ error: 'Could not revoke sessions' }, { status: 500, headers: NO_STORE_HEADERS });
  }

  // The user's own choice at the login screen, carried across the reissue.
  const token = issueSessionToken({
    sessionSecret: updated.sessionSecret,
    credentialKey: updated.credentialKey,
    ttlMs,
  });

  return json(
    {
      success: true,
      sessionsRevoked: true,
      // A false here means the new secret is in memory only: the revocation
      // holds until the process restarts, at which point the old secret is read
      // back from disk. The UI says so rather than implying permanence.
      persisted,
    },
    {
      headers: {
        ...NO_STORE_HEADERS,
        'set-cookie': sessionCookieHeader(sessionCookieName(request.headers), token, ttlMs, isSecureRequest(request)),
      },
    },
  );
}
