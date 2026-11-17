/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The batch verbs, one call per noun.
 *
 * Both are server routes rather than a client loop: a loop of N single deletes
 * would pay N round trips for one user action, and each of them republishes the
 * sidebar on its own. The server answers ONE summary — what was removed, and
 * per-id refusals with their own reason — which is what the confirmation dialog
 * reports after it closes.
 */

import { chunkIds, SESSION_BATCH_LIMIT, WORKSPACE_BATCH_LIMIT } from '@/shared/lib/sessions/batch-limits';

export interface BatchDeleteRefusal {
  id: string;
  error: string;
  code?: string;
}

export interface BatchDeleteOutcome {
  removed: string[];
  refused: BatchDeleteRefusal[];
  /** Set only when the request itself failed (network, 4xx, 5xx). */
  error?: string;
}

const EMPTY: BatchDeleteOutcome = { removed: [], refused: [] };

async function postBatch(url: string, ids: readonly string[]): Promise<BatchDeleteOutcome> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ids }),
    });
    const body = (await res.json().catch(() => null)) as Partial<BatchDeleteOutcome> | null;
    if (!res.ok) {
      return { ...EMPTY, error: body?.error || `Could not delete (HTTP ${res.status}).` };
    }
    return {
      removed: Array.isArray(body?.removed) ? body.removed : [],
      refused: Array.isArray(body?.refused) ? body.refused : [],
    };
  } catch (error) {
    return { ...EMPTY, error: error instanceof Error ? error.message : 'Could not reach the server.' };
  }
}

/** Send one request per chunk and merge the verdicts, in selection order. */
async function postInChunks(
  url: string,
  ids: readonly string[],
  limit: number,
): Promise<BatchDeleteOutcome> {
  const removed: string[] = [];
  const refused: BatchDeleteRefusal[] = [];
  let error: string | undefined;
  for (const chunk of chunkIds(ids, limit)) {
    const outcome = await postBatch(url, chunk);
    removed.push(...outcome.removed);
    refused.push(...outcome.refused);
    // First failure is the one reported: a later chunk's identical network
    // error adds nothing, and the dialog names the reason once.
    error ??= outcome.error;
  }
  return { removed, refused, ...(error ? { error } : {}) };
}

/** Remove sessions, transcripts included. Pending `new-…` ids are refused by the server.
 *
 *  The selection is split into `SESSION_BATCH_LIMIT` requests rather than
 *  refused as a whole: the sidebar lets the user select every row, and an
 *  imported history is routinely larger than one request's bound. */
export function deleteSessionsBatch(ids: readonly string[]): Promise<BatchDeleteOutcome> {
  if (ids.length === 0) return Promise.resolve({ ...EMPTY });
  return postInChunks('/api/sessions/batch-delete', ids, SESSION_BATCH_LIMIT);
}

/**
 * Unregister workspaces. Same semantics as the single "Delete Workspace"
 * action — the transcript files on disk are NOT touched, only the sidebar
 * registration (and the tombstone that stops the sync re-adding it).
 */
export function deleteWorkspacesBatch(ids: readonly string[]): Promise<BatchDeleteOutcome> {
  if (ids.length === 0) return Promise.resolve({ ...EMPTY });
  return postInChunks('/api/folders/batch-delete', ids, WORKSPACE_BATCH_LIMIT);
}
