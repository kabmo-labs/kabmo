/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The transcript a restore replayed, as the rows the timeline renders.
 *
 * A restore resumes a chat through `session/resume` with `replayFrom`, and the
 * agent answers with the ordinary `session/update` frames a live turn produces.
 * Those reach `AcpSession` BEFORE the session is usable, so they cannot ride
 * the stream a client subscribes to later — they are collected and reduced here
 * into the same `ChatMessageData` rows `toChatMessage` builds for an omp
 * transcript. Persisting that result is what makes the next open a normal read:
 * no agent, no auth, no second replay.
 *
 * The reducer takes the LAST frame per message id: the mapper emits an
 * accumulated snapshot on every update, so the last one is the settled message.
 * A `message_end` that follows adds duration/completion, which is why it wins.
 */

import { toChatMessage } from '@/shared/lib/omp/session/messages-map';
import type { OmpMessageEntry } from '@/shared/lib/omp/session/messages-parse';
import type { ChatMessageData } from '@/shared/types/chat';
import type { AgentEvent } from '@/server/lib/omp/rpc/constants';

const MESSAGE_EVENT_TYPES: Record<string, true> = {
  message_start: true,
  message_update: true,
  message_end: true,
};

/**
 * One frame's message as a timeline row, or null when it carries none.
 *
 * Shared by the replay reducer and the live recorder so a restored row and a
 * recorded row are built by the same rule.
 */
export function chatMessageFromEvent(event: AgentEvent): ChatMessageData | null {
  const message = event.message;
  if (!message || typeof message !== 'object' || Array.isArray(message)) return null;
  const record = message as Record<string, unknown>;
  const id = typeof record.id === 'string' ? record.id : '';
  if (!id) return null;
  const timestamp = typeof record.timestamp === 'number' || typeof record.timestamp === 'string'
    ? record.timestamp
    : undefined;
  const entry = {
    type: 'message',
    id,
    ...(timestamp !== undefined ? { timestamp } : {}),
    message: record,
  } as unknown as OmpMessageEntry;
  return toChatMessage(entry);
}

export function transcriptFromReplay(events: readonly AgentEvent[]): ChatMessageData[] {
  const byId = new Map<string, Record<string, unknown>>();
  for (const event of events) {
    if (!MESSAGE_EVENT_TYPES[event.type]) continue;
    const message = event.message;
    if (!message || typeof message !== 'object' || Array.isArray(message)) continue;
    const record = message as Record<string, unknown>;
    const id = typeof record.id === 'string' ? record.id : '';
    if (!id) continue;
    byId.set(id, record);
  }
  const out: ChatMessageData[] = [];
  for (const message of byId.values()) {
    const converted = chatMessageFromEvent({ type: 'message_end', message });
    if (converted) out.push(converted);
  }
  return out;
}
