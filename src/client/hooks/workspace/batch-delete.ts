/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
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

/** Remove sessions, transcripts included. Pending `new-…` ids are refused by the server. */
export function deleteSessionsBatch(ids: readonly string[]): Promise<BatchDeleteOutcome> {
  return postBatch('/api/sessions/batch-delete', ids);
}

/**
 * Unregister workspaces. Same semantics as the single "Delete Workspace"
 * action — the transcript files on disk are NOT touched, only the sidebar
 * registration (and the tombstone that stops the sync re-adding it).
 */
export function deleteWorkspacesBatch(ids: readonly string[]): Promise<BatchDeleteOutcome> {
  return postBatch('/api/folders/batch-delete', ids);
}
