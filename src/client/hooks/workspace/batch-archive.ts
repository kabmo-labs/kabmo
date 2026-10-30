/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The batch archive verb, and the sentence a finished run reports.
 *
 * Archive is the reversible sibling of delete, so it has no confirmation
 * dialog: the bar's Archive acts on the selection and the outcome is summarised
 * as one toast. The server still answers per-id verdicts — a pending `new-…`
 * chat cannot be archived — so the summary must name both what was archived and
 * what was refused rather than reporting a bare count the user cannot reconcile
 * against the list.
 */

export interface BatchArchiveRefusal {
  id: string;
  error: string;
  code?: string;
}

export interface BatchArchiveOutcome {
  archived: string[];
  refused: BatchArchiveRefusal[];
  /** Set only when the request itself failed (network, 4xx, 5xx). */
  error?: string;
}

const EMPTY: BatchArchiveOutcome = { archived: [], refused: [] };

async function postBatch(url: string, ids: readonly string[]): Promise<BatchArchiveOutcome> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ids }),
    });
    const body = (await res.json().catch(() => null)) as Partial<BatchArchiveOutcome> | null;
    if (!res.ok) {
      return { ...EMPTY, error: body?.error || `Could not archive (HTTP ${res.status}).` };
    }
    return {
      archived: Array.isArray(body?.archived) ? body.archived : [],
      refused: Array.isArray(body?.refused) ? body.refused : [],
    };
  } catch (error) {
    return { ...EMPTY, error: error instanceof Error ? error.message : 'Could not reach the server.' };
  }
}

/** Archive sessions in one request. Pending `new-…` ids are refused by the server. */
export function archiveSessionsBatch(ids: readonly string[]): Promise<BatchArchiveOutcome> {
  return postBatch('/api/sessions/batch-archive', ids);
}

/**
 * The one line a finished archive run reports, for a toast. Null when the run
 * changed nothing and has nothing to say.
 */
export function archiveOutcomeMessage(
  outcome: BatchArchiveOutcome,
): { message: string; tone: 'success' | 'error' } | null {
  if (outcome.error) return { message: outcome.error, tone: 'error' };
  const archived = outcome.archived.length;
  const refused = outcome.refused.length;
  if (archived === 0 && refused === 0) return null;
  if (refused === 0) {
    return { message: `Archived ${archived} ${archived === 1 ? 'session' : 'sessions'}.`, tone: 'success' };
  }
  if (archived === 0) {
    return { message: `${refused} ${refused === 1 ? 'session' : 'sessions'} could not be archived.`, tone: 'error' };
  }
  return {
    message: `Archived ${archived} ${archived === 1 ? 'session' : 'sessions'}; ${refused} refused.`,
    tone: 'error',
  };
}
