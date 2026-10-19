/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * `POST /api/auth/password` — change the UI password for the running server.
 *
 * Not public: the gate requires a session, so the caller has already proven they
 * know the current password. It is re-verified anyway — a session outlives the
 * password it was minted for on another tab, and a password change is the one
 * action worth asking twice about.
 *
 * The change is IN MEMORY, which is what the design allows: nothing on disk can
 * hold a password, so there is nothing durable to update. It lasts until the
 * process exits; the next start gets its password from `--ui-password` or
 * `KABMO_UI_PASSWORD` again. The response says so, because a user who
 * believes they changed a stored password would be surprised by a restart.
 *
 * Every OTHER session is revoked by the change: a token carries a fingerprint of
 * the password hash, so the new hash invalidates the whole set. This browser gets
 * a replacement cookie, which is the difference between "password changed" and
 * "password changed, and you are now at the login screen".
 */

import { json, NO_STORE_HEADERS } from '@/server/lib/remix-compat';
import type { ActionFunctionArgs } from '@/server/lib/remix-compat';
import { methodNotAllowed, parseJsonBody } from '@/server/lib/route-adapter';
import { verifyPassword } from '@/server/lib/auth/config';
import { loadAuthConfig, replaceActivePassword } from '@/server/lib/auth/guard';
import { issueSessionToken, isSecureRequest, readSessionCookie, sessionCookieHeader, sessionCookieName, sessionRemainingMs, SESSION_TTL_MS } from '@/server/lib/auth/token';

/** Shortest accepted password. Below this the argon2 cost stops being the weak link. */
export const MIN_PASSWORD_LENGTH = 8;

export async function action({ request, params }: ActionFunctionArgs) {
  if (request.method !== 'POST') return methodNotAllowed({ request, params });

  const config = loadAuthConfig();
  if (!config) {
    return json({ error: 'UI authentication is not enabled' }, { status: 400, headers: NO_STORE_HEADERS });
  }

  const parsed = await parseJsonBody<{ currentPassword?: unknown; newPassword?: unknown }>(request);
  if (!parsed.ok) {
    return json({ error: 'Invalid request body' }, { status: 400, headers: NO_STORE_HEADERS });
  }

  const currentPassword = typeof parsed.body?.currentPassword === 'string' ? parsed.body.currentPassword : '';
  const newPassword = typeof parsed.body?.newPassword === 'string' ? parsed.body.newPassword : '';

  if (!(await verifyPassword(currentPassword, config.passwordHash))) {
    return json({ error: 'Current password is incorrect' }, { status: 401, headers: NO_STORE_HEADERS });
  }
  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    return json(
      { error: `New password must be at least ${MIN_PASSWORD_LENGTH} characters` },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }
  if (newPassword === currentPassword) {
    return json({ error: 'New password must differ from the current one' }, { status: 400, headers: NO_STORE_HEADERS });
  }

  // Read BEFORE the change: the new password derives a new credential key, so
  // the presented token stops verifying the moment it is applied — reading
  // afterwards always answered "unusable" and fell back to the default, which is
  // how a 7-day session silently became a 12-hour one.
  const ttlMs = sessionRemainingMs(readSessionCookie(request), {
    sessionSecret: config.sessionSecret,
    credentialKey: config.credentialKey,
  }) ?? SESSION_TTL_MS;

  await replaceActivePassword(newPassword);
  const updated = loadAuthConfig();
  if (!updated) {
    return json({ error: 'Could not apply the new password' }, { status: 500, headers: NO_STORE_HEADERS });
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
      // Stated in the payload so the UI can say it without guessing: this
      // password lives for this process only.
      persistsUntilRestart: true,
    },
    {
      headers: {
        ...NO_STORE_HEADERS,
        'set-cookie': sessionCookieHeader(sessionCookieName(request.headers), token, ttlMs, isSecureRequest(request)),
      },
    },
  );
}
