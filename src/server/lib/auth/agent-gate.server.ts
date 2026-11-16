/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The agent-token half of the gate: may this subprocess touch that session?
 *
 * Split out of `guard.ts` for two reasons. The file ceiling is one, but the
 * real one is that this is a different question from "is there a UI session":
 * a browser cookie is all-or-nothing, while an agent token is scoped to a
 * session TREE. Keeping the two rules in one function made the tree rule look
 * like a path check, which is exactly the bug it replaces.
 *
 * Three outcomes, because the caller must distinguish "not an agent request"
 * (fall through to the device/401 path) from "an agent request that is allowed"
 * (stop, allow) and "an agent request that is refused" (stop, 403).
 */

import {
  agentTokenScopeForPath,
  bearerToken,
  lookupAgentToken,
} from '@/server/lib/sessions/agent-token.server';
import { resolveAgentAccess } from '@/server/lib/sessions/relation-access.server';

export type AgentGateOutcome =
  | { kind: 'none' }
  | { kind: 'pass' }
  | { kind: 'deny'; response: Response };

/**
 * The answer for a valid agent token naming a session outside its tree.
 *
 * Deliberately identical for "exists but is not yours" and "does not exist": a
 * gate that distinguished them would be an id oracle for any agent process. The
 * routes keep their own 404 for callers that already passed this check.
 */
function refusal(): Response {
  return new Response(
    JSON.stringify({ error: 'That session is not in this session’s tree', code: 'session_not_in_tree' }),
    { status: 403, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } },
  );
}

/**
 * Resolve one request against the agent-token rule.
 *
 * Spawn is the one path any token may call (a child must be able to create its
 * own children); every other agent path names a session that must be in the
 * token's tree — itself, an ancestor, or a descendant. The lookup falls back to
 * the table so a peer instance that never saw the spawn still recognises the
 * token.
 */
export async function agentGate(request: Request, pathname: string): Promise<AgentGateOutcome> {
  const scope = agentTokenScopeForPath(pathname);
  if (!scope) return { kind: 'none' };

  const agentSession = await lookupAgentToken(bearerToken(request));
  if (!agentSession) return { kind: 'none' };
  if (scope.kind === 'any') return { kind: 'pass' };
  if (await resolveAgentAccess(agentSession, scope.target)) return { kind: 'pass' };
  return { kind: 'deny', response: refusal() };
}
