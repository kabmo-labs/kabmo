/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Server-side tool normalization: the ONE place a LIVE agent frame becomes a
 * renderer family.
 *
 * The client used to classify tools itself (name-first panel lookup, a separate
 * `type` inference, and a third answer from ACP `kind`), which is why one
 * logical shell call rendered differently per harness. The shared resolver
 * (`shared/lib/chat/tool/render-key.ts`) now runs at ingress instead:
 *
 *  - live frames (`message_start`/`message_update`/`message_end`) are annotated
 *    before they reach the realtime topic, so the client copies `render` and
 *    never derives it;
 *  - stored/imported transcripts and replayed ACP history go through the same
 *    `normalizeMessageTools` over their mapped rows;
 *  - ACP needs no branch of its own: `AcpSession.emit` produces the same
 *    `AgentEvent`s omp does.
 *
 * Annotation is idempotent — a block that already carries a valid key is left
 * untouched, so a re-published or peer-relayed frame costs nothing.
 */

import type { AgentEvent } from '@/server/lib/omp/rpc/constants';
import type { ToolRender } from '@kabmo-labs/kabmo-chat-contracts/tool-render';
import { isToolRenderKey, resolveToolRender } from '@kabmo-labs/kabmo-chat-tool/render-key';
import { isRecord } from '@kabmo-labs/kabmo-guards';

interface ToolCallBlock {
  type: 'toolCall';
  id?: unknown;
  name?: unknown;
  title?: unknown;
  arguments?: unknown;
  input?: unknown;
  toolKind?: unknown;
  rawKind?: unknown;
  render?: unknown;
}

/** The renderer family for one wire block, from the facts that block carries. */
function renderForBlock(block: ToolCallBlock): ToolRender {
  return resolveToolRender({
    ...(typeof block.name === 'string' ? { name: block.name } : {}),
    ...(typeof block.title === 'string' ? { title: block.title } : {}),
    ...(typeof block.toolKind === 'string' ? { kind: block.toolKind } : {}),
    ...(typeof block.rawKind === 'string' ? { rawKind: block.rawKind } : {}),
    ...(block.arguments !== undefined
      ? { input: block.arguments }
      : block.input !== undefined
        ? { input: block.input }
        : {}),
  });
}

/** Annotate the toolCall blocks of one message value, returning the SAME value
 *  when there is nothing to add. */
function normalizeMessage(message: unknown): unknown {
  if (!isRecord(message) || !Array.isArray(message.content)) return message;
  let changed = false;
  const content = message.content.map((block) => {
    if (!isRecord(block) || block.type !== 'toolCall') return block;
    if (isRecord(block.render) && isToolRenderKey(block.render.key)) return block;
    changed = true;
    return { ...block, render: renderForBlock(block as unknown as ToolCallBlock) };
  });
  return changed ? { ...message, content } : message;
}

const MESSAGE_EVENT_TYPES: Record<string, true> = {
  message_start: true,
  message_update: true,
  message_end: true,
};

/**
 * Annotate one live agent frame. Returns the same object when the frame carries
 * no unnormalized tool call, so the hot path allocates only for work it did.
 */
export function normalizeAgentEvent<T extends AgentEvent>(event: T): T {
  if (MESSAGE_EVENT_TYPES[event.type] !== true) return event;
  const message = normalizeMessage(event.message);
  return (message === event.message ? event : { ...event, message }) as T;
}
