/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * `POST /api/auth/login` — exchange the UI password for a session cookie.
 *
 * Public (it is the way in), which is why it is the one route that must not be
 * cheap: the attempt budget is consumed BEFORE any verification, so a lockout
 * costs an attacker nothing to trigger but denies them every subsequent guess,
 * and argon2id makes each allowed guess ~70 ms.
 *
 * Every failure answers the same 401 body. Distinguishing "no password
 * configured" from "wrong password" would tell a caller which installs are open,
 * and the client has `/api/auth/state` for that question anyway.
 */

import { json, NO_STORE_HEADERS } from '@/server/lib/remix-compat';
import type { ActionFunctionArgs } from '@/server/lib/remix-compat';
import { methodNotAllowed, parseJsonBody } from '@/server/lib/route-adapter';
import { loadAuthConfig } from '@/server/lib/auth/guard';
import { verifyPassword } from '@/server/lib/auth/config';
import { isSecureRequest, issueSessionToken, sessionCookieHeader, sessionCookieName, SESSION_TTL_MS, TRUSTED_DEVICE_TTL_MS } from '@/server/lib/auth/token';
import { clientAddressFor } from '@/server/lib/auth/client-address';
import {
  checkLoginRateLimit,
  clearLoginRateLimit,
  recordLoginFailure,
  RATE_LIMIT_MAX_ATTEMPTS,
} from '@/server/lib/auth/rate-limit';

const LOCKED_BODY = { error: 'Invalid password', locked: true } as const;

export async function action({ request, params }: ActionFunctionArgs) {
  if (request.method !== 'POST') return methodNotAllowed({ request, params });

  const config = loadAuthConfig();
  if (!config) {
    return json({ error: 'UI authentication is not enabled' }, { status: 400, headers: NO_STORE_HEADERS });
  }

  const clientKey = clientAddressFor(request);
  const status = checkLoginRateLimit(clientKey);

  const rateHeaders = {
    ...NO_STORE_HEADERS,
    'x-ratelimit-limit': String(status.limit),
    'x-ratelimit-remaining': String(status.remaining),
  };

  if (!status.allowed) {
    return json(
      { error: 'Too many login attempts, please try again later', retryAfter: status.retryAfterSec },
      { status: 429, headers: { ...rateHeaders, 'retry-after': String(status.retryAfterSec ?? 0) } },
    );
  }

  const parsed = await parseJsonBody<{ password?: unknown; trustDevice?: unknown }>(request);
  const candidate = parsed.ok && typeof parsed.body?.password === 'string' ? parsed.body.password : '';

  if (!candidate || !(await verifyPassword(candidate, config.passwordHash))) {
    const afterFailure = recordLoginFailure(clientKey);
    if (!afterFailure.allowed) {
      return json(
        { error: 'Too many login attempts, please try again later', retryAfter: afterFailure.retryAfterSec },
        { status: 429, headers: { ...rateHeaders, 'retry-after': String(afterFailure.retryAfterSec ?? 0) } },
      );
    }
    return json(LOCKED_BODY, { status: 401, headers: { ...rateHeaders, 'x-ratelimit-remaining': String(afterFailure.remaining) } });
  }

  clearLoginRateLimit(clientKey);

  const trustDevice = parsed.ok && parsed.body?.trustDevice === true;
  const ttlMs = trustDevice ? TRUSTED_DEVICE_TTL_MS : SESSION_TTL_MS;
  const token = issueSessionToken({
    sessionSecret: config.sessionSecret,
    credentialKey: config.credentialKey,
    ttlMs,
  });

  return json(
    { authenticated: true, expiresInSec: Math.floor(ttlMs / 1000) },
    {
      headers: {
        ...NO_STORE_HEADERS,
        'x-ratelimit-limit': String(RATE_LIMIT_MAX_ATTEMPTS),
        'x-ratelimit-remaining': String(RATE_LIMIT_MAX_ATTEMPTS),
        'set-cookie': sessionCookieHeader(sessionCookieName(request.headers), token, ttlMs, isSecureRequest(request)),
      },
    },
  );
}
