/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The batch DELETE verb from the client side.
 *
 * The user-visible defect: selecting every row in the sidebar sent one body the
 * route refused (`At most 500 sessions can be deleted at once.`). The verb now
 * splits the selection, so this suite asserts what actually crosses `fetch`:
 * two requests past the bound, whole-selection merging, and the first
 * request-level failure kept as the reported reason.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { deleteSessionsBatch } from '@/client/hooks/workspace/batch-delete';
import { SESSION_BATCH_LIMIT } from '@/shared/lib/sessions/batch-limits';

interface Sent {
  url: string;
  ids: string[];
}

const nativeFetch = globalThis.fetch;
const sent: Sent[] = [];
let respond: (body: { ids: string[] }) => { status: number; body: unknown };

beforeEach(() => {
  sent.length = 0;
  respond = ({ ids }) => ({ status: 200, body: { success: true, removed: ids, removedDependents: [], refused: [] } });
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    // The body is this module's own JSON, so the shape is known here.
    const body = JSON.parse(String(init?.body ?? '{}')) as { ids?: string[] };
    const ids = body.ids ?? [];
    sent.push({ url, ids });
    const answer = respond({ ids });
    return new Response(JSON.stringify(answer.body), {
      status: answer.status,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = nativeFetch;
});

function ids(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `session-${index}`);
}

describe('deleteSessionsBatch', () => {
  test('a selection past the bound is split into requests of the bound', async () => {
    const selection = ids(SESSION_BATCH_LIMIT + 115);
    const outcome = await deleteSessionsBatch(selection);

    expect(sent.map((request) => request.ids.length)).toEqual([SESSION_BATCH_LIMIT, 115]);
    expect(sent.every((request) => request.url === '/api/sessions/batch-delete')).toBe(true);
    // The dialog counts `removed`; a lost id would read as a refusal.
    expect(outcome.removed).toEqual(selection);
    expect(outcome.refused).toEqual([]);
    expect(outcome.error).toBeUndefined();
  });

  test('refusals from every chunk are merged, not overwritten', async () => {
    respond = ({ ids: chunk }) => ({
      status: 200,
      body: {
        success: false,
        removed: chunk.slice(1),
        removedDependents: [],
        refused: [{ id: chunk[0], error: 'This session is working.', code: 'session_busy' }],
      },
    });

    const outcome = await deleteSessionsBatch(ids(SESSION_BATCH_LIMIT + 1));
    expect(outcome.refused.map((refusal) => refusal.id)).toEqual(['session-0', `session-${SESSION_BATCH_LIMIT}`]);
    expect(outcome.removed).toHaveLength(SESSION_BATCH_LIMIT - 1);
  });

  test('a request-level failure keeps the server reason and the other chunks’ verdicts', async () => {
    let call = 0;
    respond = ({ ids: chunk }) => {
      call += 1;
      if (call === 1) return { status: 500, body: { error: 'Could not delete (HTTP 500).' } };
      return { status: 200, body: { success: true, removed: chunk, removedDependents: [], refused: [] } };
    };

    const outcome = await deleteSessionsBatch(ids(SESSION_BATCH_LIMIT + 1));
    expect(outcome.error).toContain('HTTP 500');
    expect(outcome.removed).toEqual([`session-${SESSION_BATCH_LIMIT}`]);
  });

  test('progress reports each settled chunk, cumulatively', async () => {
    const seen: { done: number; total: number }[] = [];
    await deleteSessionsBatch(ids(SESSION_BATCH_LIMIT + 115), (progress) => seen.push(progress));
    // One report per request, and `done` counts ids that SETTLED — a chunk's
    // answer covers every id it carried, removed or refused.
    expect(seen).toEqual([
      { done: SESSION_BATCH_LIMIT, total: SESSION_BATCH_LIMIT + 115 },
      { done: SESSION_BATCH_LIMIT + 115, total: SESSION_BATCH_LIMIT + 115 },
    ]);
  });

  test('an empty selection sends nothing', async () => {
    const outcome = await deleteSessionsBatch([]);
    expect(sent).toEqual([]);
    expect(outcome).toEqual({ removed: [], refused: [] });
  });
});
