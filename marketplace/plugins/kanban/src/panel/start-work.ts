/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Starting work on a card: one call to the route the composer itself uses.
 *
 * `POST /api/agent/new` already does everything a chat's first send does — it
 * resolves the model when the request names none (project default, then the
 * persisted pick), applies `set_model`/`set_thinking_level`, spawns omp or an
 * ACP harness, and runs the first prompt. So the board is not a second spawn
 * path: it fills the request from `resolveAgent` and then records the session id
 * the route answers with.
 *
 * That answer is why there is no pending-session heuristic here. `openNew()`
 * returns nothing and the real id arrives later; this route returns it now, so
 * the card is linked on the same response.
 */

import type { Card, ResolvedAgent } from '../protocol';
import { dispatchText } from '../store/resolve';

/** What the route takes, built from a card and its resolved agent. */
export interface StartWorkBody {
  type: 'prompt';
  cwd: string;
  harness: string;
  message: string;
  accessMode: string;
  systemPrompt?: string;
  provider?: string;
  modelId?: string;
  thinkingLevel?: string;
  skills?: string[];
  images?: { data: string; mimeType: string }[];
}

/**
 * The request a card dispatches.
 *
 * `cwd` is the card's workspace. A card with none cannot be started — the
 * alternative is a chat born in the server's own directory, which is a project
 * nobody chose — so the caller refuses before building this.
 */
export function startWorkBody(card: Card, resolved: ResolvedAgent): StartWorkBody {
  if (!card.workspace) {
    throw new Error('Pick a workspace for this card before starting work.');
  }
  const { systemPrompt, message } = dispatchText(resolved, card.task.prompt);
  return {
    type: 'prompt',
    cwd: card.workspace,
    harness: resolved.harness,
    message,
    accessMode: resolved.access,
    ...(systemPrompt ? { systemPrompt } : {}),
    ...(resolved.model ? { provider: resolved.model.provider, modelId: resolved.model.modelId } : {}),
    ...(resolved.thinking ? { thinkingLevel: resolved.thinking } : {}),
    ...(resolved.skills.length ? { skills: resolved.skills } : {}),
    ...(card.task.images.length
      ? { images: card.task.images.map((image) => ({ data: image.dataBase64, mimeType: image.mimeType })) }
      : {}),
  };
}

/** What the route answers. */
interface StartWorkAnswer {
  success?: boolean;
  sessionId?: string;
  error?: string;
  code?: string;
}

export type StartWorkOutcome = { ok: true; sessionId: string } | { ok: false; error: string };

/**
 * Spawn the chat for a card.
 *
 * A refusal keeps the sentence the server wrote — `mock_mode`, a missing cwd, an
 * over-long system prompt — because each names something the board cannot
 * reconstruct, and a generic "could not start" would hide which.
 */
export async function startWork(
  card: Card,
  resolved: ResolvedAgent,
  post: (body: StartWorkBody) => Promise<StartWorkAnswer>,
): Promise<StartWorkOutcome> {
  let body: StartWorkBody;
  try {
    body = startWorkBody(card, resolved);
  } catch (cause) {
    return { ok: false, error: cause instanceof Error ? cause.message : String(cause) };
  }
  if (!body.message.trim()) return { ok: false, error: 'This card has no prompt to send.' };
  const answer = await post(body);
  if (answer.success === true && answer.sessionId) return { ok: true, sessionId: answer.sessionId };
  return { ok: false, error: answer.error ?? 'The chat could not be started.' };
}

/**
 * Continue a card's existing session.
 *
 * The stage prompt is PREPENDED here, because a live session's spawn flags are
 * already fixed — the same sentence the card sheet shows.
 */
export function followUpBody(card: Card, resolved: ResolvedAgent): Record<string, unknown> {
  const { message } = dispatchText({ ...resolved, promptDelivery: 'prepended' }, card.task.prompt);
  return {
    type: 'prompt',
    message,
    ...(card.task.images.length
      ? { images: card.task.images.map((image) => ({ data: image.dataBase64, mimeType: image.mimeType })) }
      : {}),
  };
}

/**
 * The commands a follow-up applies before its prompt.
 *
 * Two commands, not one: `set_model` and `set_thinking_level` are separate RPC
 * verbs, and the queue's delivery applies them in this order for the same
 * reason — a thinking level is only meaningful against the model it will run on.
 */
export function modelCommands(resolved: ResolvedAgent): Record<string, unknown>[] {
  const commands: Record<string, unknown>[] = [];
  if (resolved.model) {
    commands.push({ type: 'set_model', provider: resolved.model.provider, modelId: resolved.model.modelId });
  }
  if (resolved.thinking) commands.push({ type: 'set_thinking_level', level: resolved.thinking });
  return commands;
}
