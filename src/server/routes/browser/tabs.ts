/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * POST /api/browser/:sessionId/tabs/close — close one page this session's omp
 * agent opened in the project-shared Chromium.
 *
 * Why the panel needs it: an agent that visits several pages leaves them all
 * open in the shared daemon. The panel attaches to the newest owned target, so
 * a pile of stale tabs is one more reason it shows the wrong page, and each one
 * keeps a renderer alive.
 *
 * The ownership rule and the CDP behaviour are `shared/lib/browser/tab-close.ts`
 * (one copy, so the panel and this route cannot disagree). This module only
 * turns them into status codes:
 *
 * - 404 the session is not running here — there is no agent whose tab to close
 * - 503 no shared browser for the session's project (nothing to connect to)
 * - 403 the target is not one of THIS session's tabs
 * - 200 closed, with the surviving tabs and the neighbour to select next
 *
 * A target the browser no longer knows is reported as `alreadyClosed: true`
 * rather than an error: the caller asked for a tab to be gone, and it is.
 */

import { json, type ActionFunctionArgs } from '@/server/lib/remix-compat';
import { parseJsonBody, requireParam } from '@/server/lib/route-adapter';
import { isMockMode } from '@/server/mock.server';
import { getRpcSession } from '@/server/lib/omp/rpc/session-registry';
import { findProjectRuntimeDir, readOwnedTargetIds } from '@/server/lib/browser/runtime';
import { acquireConnection, releaseConnection } from '@/shared/lib/browser/connection';
import { closeVerdict, neighbourTargetId, readCloseTarget } from '@/shared/lib/browser/tab-close';

interface CloseBody {
  targetId?: unknown;
}

export async function action({ request, params }: ActionFunctionArgs) {
  const sessionId = requireParam(params, 'sessionId');
  if (!sessionId) return json({ error: 'Missing session id' }, { status: 400 });
  if (isMockMode()) {
    return json({ error: 'The shared browser is not available in MOCK mode' }, { status: 503 });
  }

  const parsed = await parseJsonBody<CloseBody>(request);
  if (!parsed.ok) return json({ error: 'Invalid JSON body' }, { status: 400 });
  const targetId = readCloseTarget(parsed.body.targetId);
  if (!targetId) return json({ error: 'Missing or malformed targetId' }, { status: 400 });

  const session = getRpcSession(sessionId);
  if (!session || !session.isAlive() || session.pid === undefined) {
    return json({ error: 'This session is not running, so it owns no browser tabs' }, { status: 404 });
  }

  const runtime = await findProjectRuntimeDir(session.cwd);
  if (!runtime) return json({ error: 'No shared browser is running for this project' }, { status: 503 });

  // Ownership is decided against the on-disk registry, the same source the
  // viewer scopes its tab list to: the daemon hosts every session's pages, so
  // a target id from another one must be refused rather than attempted.
  const owned = await readOwnedTargetIds(runtime.runtimeDir, runtime.daemonName, session.pid);
  const verdict = closeVerdict(targetId, owned);
  if (!verdict.ok) {
    return json({ error: verdict.reason, remaining: verdict.remaining }, { status: 403 });
  }

  const conn = await acquireConnection(runtime.wsUrl).catch(() => null);
  if (!conn) return json({ error: 'Could not reach the shared browser' }, { status: 503 });
  try {
    const reply = await conn.send('Target.closeTarget', { targetId }).catch((error: unknown) => error);
    if (reply instanceof Error) {
      // "No target found for targetId" is the page having gone away already:
      // the outcome the caller asked for, not a failure of this request.
      if (reply.message.includes('No target found')) {
        return json({ ok: true, alreadyClosed: true, remaining: verdict.remaining, next: neighbourTargetId(owned, targetId) });
      }
      return json({ error: reply.message }, { status: 502 });
    }
    return json({ ok: true, alreadyClosed: false, remaining: verdict.remaining, next: neighbourTargetId(owned, targetId) });
  } finally {
    releaseConnection(runtime.wsUrl, conn);
  }
}
