/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * POST /api/sessions/batch-delete — remove several sessions in one request.
 *
 * The sidebar's batch mode is one user action over N rows, so it is one request:
 * a client loop would pay N round trips and republish the sidebar N times, and
 * the confirmation dialog would have to reassemble N answers into one summary.
 *
 * Each id goes through the SAME sequence as the single DELETE
 * (`removeSession`), and a refusal is a verdict rather than an abort: a batch
 * that contained one mid-run session must still delete the other nineteen, and
 * the caller is told exactly which ids were refused and why. `removed` is what
 * the dialog counts; `refused` is what it lists.
 */

import { json } from '@kabmo-labs/kabmo-http';
import type { ActionFunctionArgs } from '@kabmo-labs/kabmo-http';
import { methodNotAllowed, parseJsonBody } from '@/server/lib/route-adapter';
import { removeSessionTree } from '@/server/lib/omp/session/delete-flow.server';
import { createAgentSessionRemover } from '@/server/lib/harness/session-delete.server';
import { SESSION_BATCH_LIMIT } from '@/shared/lib/sessions/batch-limits';

/** One request cannot carry an unbounded selection. The client splits a larger
 *  selection into requests of this size (`chunkIds`), so the bound is a request
 *  guard rather than a product limit. */

export async function batchDeleteSessions({ request }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return methodNotAllowed({ request, params: {} });
  }

  const parsed = await parseJsonBody<{ ids?: unknown }>(request);
  if (!parsed.ok) return json({ error: 'Invalid JSON body' }, { status: 400 });

  const raw = parsed.body.ids;
  if (!Array.isArray(raw) || raw.some((id) => typeof id !== 'string' || id.length === 0)) {
    return json({ error: 'ids must be an array of session ids' }, { status: 400 });
  }
  const ids = [...new Set(raw as string[])];
  if (ids.length === 0) return json({ error: 'No sessions selected' }, { status: 400 });
  if (ids.length > SESSION_BATCH_LIMIT) {
    return json({ error: `At most ${SESSION_BATCH_LIMIT} sessions can be deleted at once.` }, { status: 400 });
  }

  const removed: string[] = [];
  const removedDependents: string[] = [];
  const refused: { id: string; error: string; code?: string }[] = [];

  // Sequential, deliberately: every removal may have to destroy an omp child
  // and wait for its exit, and running those in parallel would open one
  // transcript writer per session at once for no gain — the work is dominated
  // by process teardown, not by the filesystem.
  //
  // One agent remover for the request: 300 imported chats on the same harness
  // must boot that agent once, not 300 times.
  const remover = createAgentSessionRemover();
  try {
    for (const id of ids) {
      const tree = await removeSessionTree(id, remover);
      const result = tree.result;
      if (result.ok) {
        removed.push(id);
        removedDependents.push(...tree.removedDependents);
      } else {
        refused.push({ id, error: result.error ?? 'Could not delete the session.', code: result.code });
      }
    }
  } finally {
    await remover.dispose();
  }

  return json({ success: refused.length === 0, removed, removedDependents, refused });
}
