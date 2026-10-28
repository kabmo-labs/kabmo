/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Subagent transcript page plumbing shared by the live RPC path
 * (`get_subagent_messages`) and the on-disk history route
 * (`GET /api/sessions/:id/subagents/:subagentId`): wire → ChatMessageData
 * conversion and byte-offset paging.
 */

import type { ChatMessageData, SubagentMessagesPage } from '@/shared/types';
import { toChatMessage } from '@/shared/lib/omp/session/mapper';
import { extractText } from '@/shared/lib/omp/session/parse-message-blocks';
import { normalizeThinkingLevel } from '@/shared/lib/models/thinking-levels';
import { isRecord } from '@/shared/lib/util/guards';

/** Normalize one wire message: the RPC may hand back bare omp AgentMessages
 *  or JSONL entries wrapping them as `{ message: {...} }`. */
function normalizeRawMessage(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  const inner = isRecord(value.message) ? value.message : null;
  if (!inner) return value;
  const out: Record<string, unknown> = { ...inner };
  if (out.id === undefined && typeof value.id === 'string') out.id = value.id;
  if (out.timestamp === undefined && typeof value.timestamp === 'number') out.timestamp = value.timestamp;
  return out;
}

export function convertMessages(raw: unknown[], streaming: boolean): ChatMessageData[] {
  const out: ChatMessageData[] = [];
  // omp records the thinking level as its own `thinking_level_change` entry
  // (session state), not as a per-message field. Walk the records in order and
  // stamp the level in effect onto each non-user turn, so a subagent footer
  // shows the level that served that turn — the child's own level, never the
  // parent session's. Mirrors the server's main-session loader
  // (`loadSessionMessages`).
  let currentLevel: string | undefined;
  for (const item of raw) {
    if (isRecord(item)) {
      const entryType = typeof item.type === 'string' ? item.type : '';
      if (entryType === 'thinking_level_change') {
        currentLevel = normalizeThinkingLevel(item.thinkingLevel);
        continue;
      }
      if (entryType === 'custom' || entryType === 'custom_message') {
        const customType = typeof item.customType === 'string' ? item.customType : '';
        if (customType === 'session_exit') {
          // Runtime plumbing — exit notices are never rendered.
          continue;
        }
        if (customType === 'launch-completion' || typeof item.content === 'string') {
          const contentStr = typeof item.content === 'string' ? item.content : '';
          const notice = contentStr.replace(/<\/?system-notice[^>]*>/g, '').trim();
          if (notice) {
            out.push({
              id: typeof item.id === 'string' ? item.id : `notice-${Date.now()}`,
              role: 'ai',
              content: '',
              notice,
              date: typeof item.timestamp === 'string' ? new Date(item.timestamp).toISOString() : undefined,
            });
          }
          continue;
        }
      }
      if (entryType && entryType !== 'message') continue;
    }
    const record = normalizeRawMessage(item);
    if (!record) continue;

    // toolResult rows are plumbing; pair their output & details with matching tool call.
    if (record.role === 'toolResult') {
      const toolCallId = typeof record.toolCallId === 'string' ? record.toolCallId : undefined;
      const outputText = extractText(record.content);
      const details = isRecord(record.details) ? record.details : undefined;
      const isError = record.isError === true;
      for (let i = out.length - 1; i >= 0; i--) {
        const tc = out[i].toolCalls?.find((t) => (toolCallId ? t.id === toolCallId : t.name === record.toolName));
        if (tc) {
          if (outputText) tc.output = outputText;
          if (details) tc.details = details;
          tc.status = isError ? 'error' : 'success';
          break;
        }
      }
      continue;
    }

    const converted = toChatMessage(record, streaming);
    if (!converted) continue;
    if (currentLevel !== undefined && converted.role !== 'user') {
      converted.thinkingLevel = currentLevel;
    }
    out.push(converted);
  }
  return out;
}

/** Append/replace by message id so tail refetches do not duplicate rows and a
 *  streamed message is replaced in place once finalized. */
export function mergeMessages(prev: ChatMessageData[], incoming: ChatMessageData[]): ChatMessageData[] {
  if (incoming.length === 0) return prev;
  const positions = new Map(prev.map((message, index) => [message.id, index]));
  const next = [...prev];
  for (const message of incoming) {
    const index = positions.get(message.id);
    if (index === undefined) {
      positions.set(message.id, next.length);
      next.push(message);
    } else {
      next[index] = message;
    }
  }
  return next;
}

/** Read the `{ success, data }` RPC envelope (accepting a bare page too). */
function asMessagesPage(value: unknown, fallbackFrom: number, fallbackFile: string | undefined): SubagentMessagesPage | null {
  if (!isRecord(value) || !Array.isArray(value.messages)) return null;
  const fromByte = typeof value.fromByte === 'number' ? value.fromByte : fallbackFrom;
  return {
    sessionFile: typeof value.sessionFile === 'string' && value.sessionFile ? value.sessionFile : (fallbackFile ?? ''),
    fromByte,
    nextByte: typeof value.nextByte === 'number' ? value.nextByte : fromByte,
    reset: value.reset === true,
    messages: value.messages,
    totalBytes: typeof value.totalBytes === 'number' ? value.totalBytes : undefined,
  };
}

export async function requestSubagentPage(
  sessionId: string,
  subagentId: string,
  sessionFile: string | undefined,
  fromByte: number,
): Promise<SubagentMessagesPage | null> {
  try {
    const res = await fetch(`/api/agent/${encodeURIComponent(sessionId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'get_subagent_messages',
        subagentId,
        ...(sessionFile ? { sessionFile } : {}),
        fromByte,
      }),
    });
    if (!res.ok) return null;
    const body: unknown = await res.json().catch(() => null);
    const payload = isRecord(body) && 'data' in body ? body.data : body;
    return asMessagesPage(payload, fromByte, sessionFile);
  } catch {
    return null;
  }
}

/** In-flight GET dedupe: identical page requests share one promise. Strict
 *  mode/hydration double-runs and re-renders must not double-hit the disk. */
const inflightHistory = new Map<string, Promise<SubagentMessagesPage | null>>();

/** On-disk history page (`{ page }`, or a bare page); null = end/unavailable. */
export async function requestHistoryPage(
  sessionId: string,
  subagentId: string,
  fromByte: number,
): Promise<SubagentMessagesPage | null> {
  const url = `/api/sessions/${encodeURIComponent(sessionId)}/subagents/${encodeURIComponent(subagentId)}?fromByte=${fromByte}`;
  const inflight = inflightHistory.get(url);
  if (inflight) return inflight;
  let cleanup = () => {};
  const promise = new Promise<SubagentMessagesPage | null>((resolve) => {
    cleanup = () => {
      // Only the owner removes itself; a shared waiter must not.
      if (inflightHistory.get(url) === promise) inflightHistory.delete(url);
    };
    void (async () => {
      try {
        const res = await fetch(url);
        if (!res.ok) return resolve(null);
        const body: unknown = await res.json().catch(() => null);
        const payload = isRecord(body) && 'page' in body ? body.page : body;
        if (payload === null || payload === undefined) return resolve(null);
        resolve(asMessagesPage(payload, fromByte, undefined));
      } catch {
        resolve(null);
      }
    })();
  });
  promise.then(cleanup, cleanup);
  inflightHistory.set(url, promise);
  return promise;
}
