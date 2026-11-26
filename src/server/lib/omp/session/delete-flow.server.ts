/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The one session-removal sequence, shared by the single DELETE route and the
 * batch route.
 *
 * The ORDER is the contract and it is enforced here, not by the callers:
 *  1. refuse a pending `new-…` chat and an id that is not one path segment —
 *     both name something other than the session they appear to;
 *  2. refuse a session whose child is mid-turn (a run, a live subagent, or a
 *     dialog the agent is blocked on) — the delete would kill work the user can
 *     still see, and omp would flush the file back on shutdown anyway. ANY
 *     harness: an ACP chat is live in the same registry and is just as much in
 *     the middle of something;
 *  3. destroy the child and AWAIT its exit;
 *  4. purge side questions, then the transcript, artifacts and Kabmo rows.
 *
 * Step 2/3 read `getLiveSession`, not the omp-only view: an ACP session has no
 * `AgentSessionWrapper`, so the old `getRpcSession` lookup answered "nothing is
 * live" for every non-omp chat — the delete then removed its rows while the
 * agent process kept the conversation aliased in the registry.
 *
 * A batch that re-implemented any of this would drift from the single delete,
 * and the drift would be silent: the route answers per-id verdicts either way.
 */

import { getLiveSession } from '@/server/lib/omp/rpc/session-registry';
import { loadHarnessSession } from '@kabmo-labs/kabmo-harness-session/session-store.server';
import { createAgentSessionRemover, type AgentSessionRemover } from '@kabmo-labs/kabmo-harness-session/session-delete.server';
import { purgeSessionData } from '@/server/lib/omp/session/delete.server';
import { dependentsDeepestFirst } from '@/server/lib/sessions/lifecycle.server';
import { purgeBtwForSession } from '@/server/lib/btw/purge.server';
import { isSinglePathSegment } from '@kabmo-labs/kabmo-paths/path-segment';
import { isMockMode } from '@kabmo-labs/kabmo-runtime-flags';

export interface SessionRemoval {
  /** True when the session was removed (or would have been, in mock mode). */
  ok: boolean;
  /** HTTP status the single-session route answers with; batch callers use `error`. */
  status: number;
  code?: 'session_pending' | 'invalid_id' | 'session_busy' | 'not_found' | 'agent_session_not_removed';
  error?: string;
  fileRemoved?: boolean;
  artifactsRemoved?: boolean;
  btwTopicsRemoved?: number;
}

/**
 * Remove one session, in the documented order. Never throws: every failure is
 * a verdict, because a batch has to keep going after one refused id.
 */
export async function removeSession(
  sessionId: string,
  remover?: AgentSessionRemover,
): Promise<SessionRemoval> {
  if (sessionId.startsWith('new-')) {
    return {
      ok: false,
      status: 400,
      code: 'session_pending',
      error: 'This chat has not been created yet.',
    };
  }
  // The id names a directory under the sessions root and another under the btw
  // root, so it must be exactly one path segment — see `isSinglePathSegment`
  // for the `.` case that made this load-bearing.
  if (!isSinglePathSegment(sessionId)) {
    return { ok: false, status: 400, code: 'invalid_id', error: 'Invalid session id' };
  }

  try {
    const record = await loadHarnessSession(sessionId).catch(() => null);
    // A live child is the only other writer of the transcript. Busy means a
    // turn, a live subagent, or a dialog the agent is parked on — omp's child
    // and an ACP agent's alike.
    const live = getLiveSession(sessionId);
    let agentSessionRemoved = false;
    if (live?.isAlive()) {
      if (live.isBusy()) {
        return {
          ok: false,
          status: 409,
          code: 'session_busy',
          error: 'This session is working. Stop the run before deleting it.',
        };
      }
      let failure: string | null = null;
      try {
        if (record && 'deleteAgentSession' in live && live.deleteAgentSession) {
          agentSessionRemoved = await live.deleteAgentSession();
        }
      } catch (cause) {
        failure = cause instanceof Error ? cause.message : String(cause);
      }
      await live.destroyAndWait();
      if (failure) {
        return { ok: false, status: 502, code: 'agent_session_not_removed', error: failure };
      }
    }

    // An IMPORTED chat, a closed tab and a chat whose child exited leave no live
    // process to ask, and that is the case the old flow skipped: the row went,
    // the agent kept the conversation, and the next import put the row back. The
    // agent is asked through a fresh process (or its own store is removed) before
    // any Kabmo row disappears, so a refusal leaves the sidebar truthful.
    if (record && !agentSessionRemoved) {
      const active = remover ?? createAgentSessionRemover();
      const own = remover ? null : active;
      try {
        const removal = await active.remove(record);
        if (!removal.removed) {
          return {
            ok: false,
            status: 502,
            code: 'agent_session_not_removed',
            error: removal.error
              ? `Could not delete this chat from ${record.harness}: ${removal.error}`
              : `Could not delete this chat from ${record.harness}`,
          };
        }
      } finally {
        await own?.dispose();
      }
    }

    // Side questions live outside the session file and are removed first: their
    // children must be gone before the parent transcript they were snapshotted
    // from disappears.
    const btwTopicsRemoved = isMockMode() ? 0 : await purgeBtwForSession(sessionId);
    const purged = await purgeSessionData(sessionId);
    if (!purged.found) {
      return { ok: false, status: 404, code: 'not_found', error: 'Session not found' };
    }

    return {
      ok: true,
      status: 200,
      fileRemoved: purged.fileRemoved,
      artifactsRemoved: purged.artifactsRemoved,
      btwTopicsRemoved,
    };
  } catch (error) {
    return {
      ok: false,
      status: 500,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export interface SessionTreeRemoval {
  result: SessionRemoval;
  /** Dependents removed before the root, deepest first. */
  removedDependents: string[];
}

function busyRemoval(sessionId: string): SessionRemoval {
  return {
    ok: false,
    status: 409,
    code: 'session_busy',
    error: `Session ${sessionId} is working. Stop the run before deleting the tree.`,
  };
}

/**
 * Remove a session AND its dependents.
 *
 * Every dependent is prechecked for a busy child before anything is deleted: a
 * partial cascade is worse than a refusal, because the user cannot tell which
 * half of the tree disappeared. Deepest first, so a parent never loses the rows
 * that name it before the children are gone.
 */
export async function removeSessionTree(
  sessionId: string,
  remover?: AgentSessionRemover,
): Promise<SessionTreeRemoval> {
  const rootLive = getLiveSession(sessionId);
  if (rootLive?.isAlive() && rootLive.isBusy()) {
    return { result: busyRemoval(sessionId), removedDependents: [] };
  }

  const dependents = await dependentsDeepestFirst(sessionId);
  for (const id of dependents) {
    const live = getLiveSession(id);
    if (live?.isAlive() && live.isBusy()) {
      return { result: busyRemoval(id), removedDependents: [] };
    }
  }

  // One remover for the whole tree: a dependent on the same harness reuses the
  // child the root already spawned instead of booting the agent again.
  const active = remover ?? createAgentSessionRemover();
  const own = remover ? null : active;
  const removedDependents: string[] = [];
  try {
    for (const id of dependents) {
      const verdict = await removeSession(id, active);
      if (!verdict.ok) return { result: verdict, removedDependents };
      removedDependents.push(id);
    }
    return { result: await removeSession(sessionId, active), removedDependents };
  } finally {
    await own?.dispose();
  }
}
