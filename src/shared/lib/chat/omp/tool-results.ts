/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Tool-output bookkeeping for the live agent stream.
 *
 * omp reports a tool call in an assistant message and its output in separate
 * frames (`tool_execution_update` partials, then `tool_execution_end`). The
 * timeline needs the two halves re-joined on the message that carries the call,
 * so this module owns the call-id → output map and the re-emit that pairs them.
 *
 * Split out of agent-events.ts so that file stays under the repo's per-file
 * size ceiling. The host is a narrow structural view of the fold's deps — not
 * the deps type itself — so neither module imports the other.
 */

import type { RefObject } from 'preact/compat';
import type { ChatMessageData, ToolCallData } from '@/shared/types';
import type { ToolImageRef } from '@/shared/types/chat';
import { extractTextFromContent } from '@/shared/lib/omp/session/mapper';
import { extractToolImages } from '@/shared/lib/omp/session/tool-images';

/** Tool output accumulated between a `toolCall` block and its result frame. */
export interface ToolResultRecord {
  output: string;
  isError?: boolean;
  details?: Record<string, any>;
  /** Pictures the result returned (a `read` of an image). */
  images?: ToolImageRef[];
}

/** Per-entry cap on stored tool output; the tail of a build log is what matters. */
const MAX_TOOL_OUTPUT_CHARS = 200_000;
/** Max tool results retained per session; oldest entries are dropped first. */
const MAX_TRACKED_TOOL_RESULTS = 200;

/** The slice of the fold's deps this module needs. */
export interface ToolResultHost {
  toolResultsRef: RefObject<Map<string, ToolResultRecord>>;
  lastToolMessageRef: RefObject<ChatMessageData>;
  /** Re-emit an updated assistant message into the timeline. */
  onMessageUpdate?: (msg: ChatMessageData) => void;
}

/** Truncate tool output to the cap, keeping the tail and marking the cut. */
function capToolOutput(output: string): string {
  if (output.length <= MAX_TOOL_OUTPUT_CHARS) return output;
  return `…[truncated]\n${output.slice(-MAX_TOOL_OUTPUT_CHARS)}`;
}

/** Write a tool result into the map, enforcing both caps. */
function storeToolResult(
  map: Map<string, ToolResultRecord>,
  callId: string,
  record: ToolResultRecord,
): void {
  map.set(callId, { ...record, output: capToolOutput(record.output) });
  while (map.size > MAX_TRACKED_TOOL_RESULTS) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
}

/** Write a result into the map, enforcing both caps. */
export function putToolResult(host: ToolResultHost, callId: string, record: ToolResultRecord): void {
  const map = host.toolResultsRef.current;
  if (map) storeToolResult(map, callId, record);
}

/** The `details` a tool frame reports.
 *
 *  omp nests a tool result's `details` INSIDE `result` on the live frames
 *  (`tool_execution_end`, `tool_execution_update`) — its own wire schema declares
 *  `ToolExecutionEndEvent` with only `type/toolCallId/toolName/result/isError`,
 *  and `details` lives on the `ToolResultMessage` that `result` mirrors. A
 *  `message_end` toolResult carries them at the TOP level. Reading only the top
 *  level therefore dropped every live card's details (measured against omp
 *  18.10.3: `wallTimeMs`, `exitCode`, `service`, `diff`, `phases`, … all lost
 *  on the card that had just streamed, while a reload showed them). Read both,
 *  `result` first because that is the shape the live frames use. */
export function resultDetails(frame: Record<string, unknown>): ToolResultRecord['details'] {
  const result = frame.result;
  const nested = result && typeof result === 'object' && !Array.isArray(result)
    ? (result as Record<string, unknown>).details
    : undefined;
  const details = nested && typeof nested === 'object' ? nested : frame.details;
  return details && typeof details === 'object'
    ? (details as ToolResultRecord['details'])
    : undefined;
}

/** Record a toolResult frame's output against its tool call id. */
export function recordToolResult(raw: Record<string, unknown>, host: ToolResultHost): void {
  const callId = typeof raw.toolCallId === 'string' ? raw.toolCallId : undefined;
  if (!callId) return;
  const images = extractToolImages(raw.content);
  host.toolResultsRef.current?.set(callId, {
    output: extractTextFromContent(raw.content),
    isError: raw.isError === true,
    details: resultDetails(raw),
    ...(images.length > 0 ? { images } : {}),
  });
}

/** Re-emit the last tool-carrying assistant message with its results paired. */
export function pairToolOutputs(msg: ChatMessageData, host: ToolResultHost): ChatMessageData {
  if (!msg.toolCalls?.length) return msg;
  const toolCalls = msg.toolCalls.map(tc => {
    const res = host.toolResultsRef.current?.get(tc.id);
    return res
      ? {
          ...tc,
          output: res.output,
          details: tc.details || res.details || undefined,
          ...(res.images && res.images.length > 0 ? { images: res.images } : {}),
          status: (res.isError ? 'error' : 'success') as ToolCallData['status'],
        }
      : tc;
  });
  return { ...msg, toolCalls };
}

/** Re-emit the last tool-carrying message when `callId` belongs to it. */
export function refreshToolMessage(callId: string | undefined, host: ToolResultHost): void {
  if (!callId) return;
  const last = host.lastToolMessageRef.current;
  if (!last?.toolCalls?.some(tc => tc.id === callId)) return;
  host.onMessageUpdate?.(pairToolOutputs(last, host));
}
