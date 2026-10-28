/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Client for a session's BTW API: the commands that create, continue, cancel
 * and promote a side question.
 *
 * The FRAMES are no longer here: they ride the unified realtime socket's
 * `btw:<id>` topic (see `@/client/hooks/chat/btw`). What remains is the command
 * surface, which is request/response and stays on HTTP.
 */

import type { AgentImage, BtwState } from '@/shared/types';
import type { AttachedTextFileData } from '@/shared/lib/chat/attachments';

/** A rejected command, carrying the server's machine-readable reason. */
export class BtwRequestError extends Error {
  readonly code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.name = 'BtwRequestError';
    this.code = code;
  }
}

interface BtwResponseBody {
  success?: boolean;
  data?: unknown;
  error?: string;
  code?: string;
}

async function requestBtw<T>(sessionId: string, method: 'GET' | 'POST', body?: Record<string, unknown>): Promise<T> {
  const response = await fetch(`/api/btw/${encodeURIComponent(sessionId)}`, {
    method,
    ...(body
      ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      : {}),
  });
  const payload = (await response.json().catch(() => null)) as BtwResponseBody | null;
  if (!response.ok || !payload?.success) {
    throw new BtwRequestError(payload?.error ?? `Side question request failed (${response.status})`, payload?.code);
  }
  return payload.data as T;
}

/** The session's side questions as the server sees them. */
export function fetchBtwState(sessionId: string): Promise<BtwState> {
  return requestBtw<BtwState>(sessionId, 'GET');
}

export interface AskBtwInput {
  topicId?: string;
  question: string;
  images?: AgentImage[];
  /** Text files inlined for this question (read at attach time by the composer). */
  textFiles?: AttachedTextFileData[];
}

export function askBtwQuestion(sessionId: string, input: AskBtwInput): Promise<BtwState> {
  return requestBtw<BtwState>(sessionId, 'POST', {
    action: 'ask',
    question: input.question,
    ...(input.topicId ? { topicId: input.topicId } : {}),
    ...(input.images?.length ? { images: input.images } : {}),
    ...(input.textFiles?.length ? { textFiles: input.textFiles } : {}),
  });
}

export function abortBtwQuestion(sessionId: string, topicId: string): Promise<BtwState> {
  return requestBtw<BtwState>(sessionId, 'POST', { action: 'abort', topicId });
}

export function promoteBtwTopic(sessionId: string, topicId: string): Promise<{ sessionId: string }> {
  return requestBtw<{ sessionId: string }>(sessionId, 'POST', { action: 'promote', topicId });
}

export function deleteBtwTopic(sessionId: string, topicId: string): Promise<BtwState> {
  return requestBtw<BtwState>(sessionId, 'POST', { action: 'delete', topicId });
}
