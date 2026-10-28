/**
 * @license
 * SPDX-License-Identifier: MIT
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
  /** When the call started, from `tool_execution_start`. omp reports no
   *  duration on the live frames either — `tool_execution_end` carries the
   *  result, not a span — so the card's elapsed time is this clock against
   *  the end frame. */
  startedAt?: number;
  /** Wall time the call took, filled on the end frame. */
  durationMs?: number;
  /** The call has NOT finished: a progress frame wrote this entry, not a
   *  result. `pairToolOutputs` reads it to keep the card `running`, because the
   *  map holds an entry from `tool_execution_start` onward and treating any
   *  entry as a result marked a streaming call "Done" on its first update. */
  pending?: boolean;
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
  /**
   * The transcript row that already OWNS a call the fold has not streamed.
   *
   * A page reload re-reads the JSONL and mounts a fresh fold: the card for a
   * call that started before the reload is on screen, but `lastToolMessageRef`
   * is null, so every later `tool_execution_update` / `tool_execution_end` has
   * no target to pair onto — the result never reaches the card and a blocking
   * `wait` keeps rendering the transcript's detail-less shape. This is the
   * lookup that finds that row (the same rule `run-switch.ts` states for a
   * spawn adoption, with the transcript as the evidence).
   */
  resumedToolMessage?: (callId: string) => ChatMessageData | undefined;
}

/** Truncate tool output to the cap, keeping the tail and marking the cut. */
function capToolOutput(output: string): string {
  if (output.length <= MAX_TOOL_OUTPUT_CHARS) return output;
  return `…[truncated]\n${output.slice(-MAX_TOOL_OUTPUT_CHARS)}`;
}

/** Write a tool result into the map, enforcing both caps.
 *
 *  The write REPLACES the entry, so the start clock the `tool_execution_start`
 *  frame recorded is carried forward: progress frames and the end frame each
 *  overwrite the record, and losing it there would leave a finished call with
 *  no duration at all. */
function storeToolResult(
  map: Map<string, ToolResultRecord>,
  callId: string,
  record: ToolResultRecord,
): void {
  const previous = map.get(callId);
  const startedAt = record.startedAt ?? previous?.startedAt;
  const durationMs = record.durationMs ?? previous?.durationMs;
  // An end frame clears it; a progress frame sets it. Carried forward like the
  // clock, because a snapshot with no flag must not silently settle the call.
  const pending = record.pending ?? previous?.pending;
  const merged: ToolResultRecord = {
    ...record,
    output: capToolOutput(record.output),
    ...(startedAt !== undefined ? { startedAt } : {}),
    ...(durationMs !== undefined ? { durationMs } : {}),
    ...(pending !== undefined ? { pending } : {}),
  };
  map.set(callId, merged);
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
  // `message_end` arrives AFTER `tool_execution_end` and writes the same entry.
  // The span measured there is the call's real duration, so it is kept rather
  // than re-measured against a clock that has since moved on; only a result
  // whose end frame never arrived is timed here, from the start clock.
  const previous = host.toolResultsRef.current?.get(callId);
  putToolResult(host, callId, {
    output: extractTextFromContent(raw.content),
    isError: raw.isError === true,
    details: resultDetails(raw),
    pending: false,
    ...(previous?.durationMs !== undefined
      ? { durationMs: previous.durationMs }
      : previous?.startedAt !== undefined
        ? { durationMs: Math.max(0, Date.now() - previous.startedAt) }
        : {}),
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
          ...(res.durationMs !== undefined ? { durationMs: res.durationMs } : {}),
          ...(res.startedAt !== undefined ? { startedAt: res.startedAt } : {}),
          ...(res.images && res.images.length > 0 ? { images: res.images } : {}),
          // A progress frame leaves an entry in this map from the call's START
          // onward, so "an entry exists" is not "the call returned". Treating it
          // as one settled the card on its first update: a `wait` that blocks for
          // minutes rendered as `Done` with a 0:00 clock from the moment omp sent
          // its first snapshot (measured in a browser spec).
          status: (res.pending ? 'running' : res.isError ? 'error' : 'success') as ToolCallData['status'],
        }
      : tc;
  });
  return { ...msg, toolCalls };
}

/**
 * The message a call belongs to: the fold's own last tool-carrying row, or —
 * when this fold never saw the call stream (a page reload resumed the run) —
 * the transcript row that already holds it. Adopting that row is what makes the
 * next frame able to paint it; without it the result has no target.
 */
export function toolMessageFor(host: ToolResultHost, callId: string): ChatMessageData | undefined {
  const last = host.lastToolMessageRef.current;
  if (last?.toolCalls?.some(tc => tc.id === callId)) return last;
  const resumed = host.resumedToolMessage?.(callId);
  if (resumed) host.lastToolMessageRef.current = resumed;
  return resumed;
}

/** Re-emit the last tool-carrying message when `callId` belongs to it. */
export function refreshToolMessage(callId: string | undefined, host: ToolResultHost): void {
  if (!callId) return;
  const message = toolMessageFor(host, callId);
  if (!message) return;
  host.onMessageUpdate?.(pairToolOutputs(message, host));
}
