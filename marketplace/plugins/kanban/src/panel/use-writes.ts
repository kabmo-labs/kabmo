/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The board's writes, in one place so the panel never builds a call by hand.
 *
 * Two kinds of write live here and they are deliberately different:
 *
 * - **Board writes** go through the plugin's own RPC, which takes the file lock
 *   and answers the fresh snapshot.
 * - **Starting work** goes to `/api/agent/new`, the route the chat composer
 *   itself uses. The board does not spawn anything: it fills the request from
 *   `resolveAgent` and links the session id the route answers with.
 *
 * A refusal is returned, never thrown: the sheet shows the server's own sentence
 * ("This card changed on disk", "Pick a workspace") instead of a stack trace.
 */

import { useCallback } from 'preact/hooks';
import { useRpc } from '@kabmo-labs/kabmo-ui';

import type { Card, ResolvedAgent, Stage } from '../protocol';
import { startWork, type StartWorkBody, type StartWorkOutcome } from './start-work';

/** What a write answers. */
export type WriteOutcome<T> = { ok: true; value: T } | { ok: false; error: string };

/** The answer `moveCard` gives, which carries the Start-work hint. */
export interface MoveAnswer {
  card: Card;
  next?: 'start_work_required';
  revision: number;
}

/** The POST the panel makes to spawn a chat. */
async function postStartWork(body: StartWorkBody): Promise<Record<string, unknown>> {
  const response = await fetch('/api/agent/new', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(body),
  });
  return (await response.json().catch(() => ({}))) as Record<string, unknown>;
}

/** The RPC methods the panel calls, with the outcome flattened to one shape. */
export function useWrites(onChanged: () => void) {
  const create = useRpc('createCard');
  const update = useRpc('updateCard');
  const move = useRpc('moveCard');
  const remove = useRpc('deleteCard');
  const link = useRpc('linkSession');
  const claim = useRpc('claimCard');
  const stages = useRpc('saveStages');
  const defaults = useRpc('saveDefaults');

  const settle = useCallback(
    async <T,>(outcome: { ok: boolean; value?: unknown; error?: { message: string } }): Promise<WriteOutcome<T>> => {
      if (outcome.ok) {
        onChanged();
        return { ok: true, value: outcome.value as T };
      }
      return { ok: false, error: outcome.error?.message ?? 'The board refused that write.' };
    },
    [onChanged],
  );

  return {
    createCard: useCallback(
      async (input: { title: string; status?: string; workspace?: string | null; priority?: number }) =>
        settle<{ card: Card }>(await create.call(input)),
      [create, settle],
    ),
    updateCard: useCallback(
      async (id: string, patch: Record<string, unknown>, baseUpdatedAt?: string) =>
        settle<{ card: Card }>(await update.call({ id, patch, baseUpdatedAt })),
      [settle, update],
    ),
    moveCard: useCallback(
      async (id: string, status: string, baseUpdatedAt?: string) =>
        settle<MoveAnswer>(await move.call({ id, status, baseUpdatedAt })),
      [move, settle],
    ),
    deleteCard: useCallback(async (id: string) => settle<unknown>(await remove.call({ id })), [remove, settle]),
    linkSession: useCallback(
      async (id: string, sessionId: string | null) => settle<{ card: Card }>(await link.call({ id, sessionId })),
      [link, settle],
    ),
    claimCard: useCallback(
      async (id: string, sessionId?: string) => settle<{ card: Card }>(await claim.call({ id, sessionId })),
      [claim, settle],
    ),
    saveStages: useCallback(
      async (next: Stage[]) => settle<{ board: { stages: Stage[] } }>(await stages.call({ stages: next })),
      [settle, stages],
    ),
    saveDefaults: useCallback(
      async (next: Record<string, unknown>) => settle<{ board: unknown }>(await defaults.call({ defaults: next })),
      [defaults, settle],
    ),
    /**
     * Start the card's chat, then link it.
     *
     * The link is a SECOND write and it is deliberate: the spawn already
     * happened, so a failed link must not read as a failed start. The sentence
     * names which half landed.
     */
    startWork: useCallback(
      async (card: Card, resolved: ResolvedAgent): Promise<StartWorkOutcome> => {
        const started = await startWork(card, resolved, postStartWork);
        if (!started.ok) return started;
        const linked = await settle<{ card: Card }>(await claim.call({ id: card.id, sessionId: started.sessionId }));
        if (!linked.ok) {
          return { ok: false, error: `The chat started (${started.sessionId.slice(0, 8)}…) but the card was not linked: ${linked.error}` };
        }
        return started;
      },
      [claim, settle],
    ),
  };
}
