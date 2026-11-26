/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Turn one `ToolCallData` into the shape the renderers read.
 *
 * `render` is the ONLY classification a card consumes. `type` stays the
 * transport's own word — the panels read it for a VARIANT inside one family
 * (`rewind` vs `checkpoint`), which is a different question from which family
 * the call belongs to. A row that already carries a valid key is returned
 * unchanged, so this is safe on every read of a stored transcript.
 *
 * Browser-safe by construction: the server runs it at ingress, and the sample
 * gallery runs it over its hand-written fixtures.
 */

import type { ChatMessageData, ToolCallData } from '@kabmo-labs/kabmo-chat/contracts/chat';
import { isToolRenderKey, resolveToolRender } from './render-key';

/** Annotate one tool call; the same object when it is already normalized. */
export function normalizeToolCall(call: ToolCallData): ToolCallData {
  if (call.render && isToolRenderKey(call.render.key)) return call;
  const render = resolveToolRender({
    ...(call.name ? { name: call.name } : {}),
    title: call.title,
    type: call.type,
    ...(call.input !== undefined ? { input: call.input } : {}),
    ...(call.target ? { target: call.target } : {}),
    ...(call.command ? { command: call.command } : {}),
    ...(call.details ? { details: call.details } : {}),
  });
  // `type` is left alone on purpose: it is the transport's own word, and the
  // panels that read it are asking about a VARIANT within one family
  // (`rewind` vs `checkpoint`, `glob` vs `grep`, `retain` vs `recall`). The
  // panel and the glyph read `render.key`; the two are different questions.
  return { ...call, render };
}

/** Annotate every tool call on a stored message. */
export function normalizeMessageTools(message: ChatMessageData): ChatMessageData {
  if (!message.toolCalls?.length) return message;
  let changed = false;
  const toolCalls = message.toolCalls.map((call) => {
    const next = normalizeToolCall(call);
    if (next !== call) changed = true;
    return next;
  });
  return changed ? { ...message, toolCalls } : message;
}

/**
 * Annotate every tool call on a transcript whose rows are UNTRUSTED JSON — a
 * `chat_sessions` column written by an older build, a replay buffer.
 *
 * `normalizeMessageTools` is typed for a row the app itself built. This keeps a
 * corrupt entry (a string, a `null`) exactly as it found it, so a bad write
 * cannot turn a chat load into a 500 while it is being repaired.
 */
export function normalizeTranscriptRows(rows: readonly unknown[]): unknown[] {
  return rows.map((row) => (
    row && typeof row === 'object' && !Array.isArray(row)
      ? normalizeMessageTools(row as ChatMessageData)
      : row
  ));
}
