/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The client half of the in-place rewind endpoint (`POST /api/chat/:id/rewind`).
 *
 * Two footer actions need the same call: Undo (rewind, then hand the text back
 * to the composer) and Retry (rewind, then send the same prompt again). Both
 * must report WHY a rewind was refused — the endpoint answers 400 with a code
 * and a message (an entry the file does not carry, a turn that is not a user
 * message), and the previous call sites turned every one of those into a bare
 * `false` that the UI swallowed.
 *
 * Split out of `actions.ts` so that hook keeps to the repo's per-file ceiling.
 */

import type { ChatMessageData } from '@/shared/types';

export type RewindResult =
  | { ok: true; messages: ChatMessageData[] | null }
  | { ok: false; error: string };

/**
 * Rewind `sessionId` to just before the row named by `entryId`, then re-read the
 * transcript.
 *
 * `startedAt` is the row's own clock. It is the ONLY way to resolve a cut at a
 * row the session file does not carry — a builtin command (`/usage`, `/compact`)
 * writes no entry, so its timeline row lives in Kabmo overlay alone and
 * the server cannot place it by id.
 */
export async function requestRewind(
  sessionId: string,
  entryId: string,
  startedAt?: number,
): Promise<RewindResult> {
  let res: Response;
  try {
    res = await fetch(`/api/chat/${encodeURIComponent(sessionId)}/rewind`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(startedAt === undefined ? { entryId } : { entryId, startedAt }),
    });
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Rewind request failed' };
  }

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    return { ok: false, error: body?.error ?? `Rewind failed (HTTP ${res.status})` };
  }

  // The truncated session is the new truth: re-read it so the timeline matches
  // the agent's context instead of the list the client was holding.
  const next = await fetch(`/api/chat/${encodeURIComponent(sessionId)}`)
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
  const messages = (next as { session?: { messages?: ChatMessageData[] } } | null)?.session?.messages;
  return { ok: true, messages: Array.isArray(messages) ? messages : null };
}
