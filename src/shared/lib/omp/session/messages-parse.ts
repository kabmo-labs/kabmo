/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * RELOAD-path adapter: raw omp JSONL entries → Kabmo ChatMessageData parts.
 * Content-block parsing is delegated to the shared core parser
 * (parse-message-blocks.ts) — the same one the live SSE path uses — so the
 * two render paths cannot drift. This module keeps only JSONL-specific
 * concerns: the entry wrapper shape, role folding, and image attachments.
 */

import type { ToolCallData } from '@/shared/types/chat';
import type { OmpMessageEntry } from '@/shared/types/omp/session';
import { extractInlinedTextAttachments, extractText as coreExtractText, extractUserImageAttachments, parseMessageBlocks, stripInlinedTextAttachments, toToolCallData } from '@/shared/lib/omp/session/parse-message-blocks';
import { isRecord } from '@/shared/lib/util/guards';

export { stripInlinedTextAttachments };
export type { OmpMessageEntry };

/** Extract plain text from omp content (string or [{type:'text',text},...]). */
export function extractText(content: unknown): string {
  return coreExtractText(content);
}

type ChatRole = 'user' | 'ai' | 'assistant';

export function roleFor(role: string | undefined): ChatRole {
  if (role === 'user') return 'user';
  if (role === 'assistant') return 'ai';
  return 'assistant';
}

/** Strip a toolResult's text into a plain output string (skip binary/refusal). */
export function resultOutput(message: OmpMessageEntry['message']): string {
  if (!message) return '';
  const blocks = Array.isArray(message.content) ? (message.content as Record<string, unknown>[]) : [];
  const parts: string[] = [];
  for (const block of blocks) {
    if (!isRecord(block) || block.type !== 'text') continue;
    if (typeof block.text === 'string') parts.push(block.text);
  }
  // Deliberately untrimmed: whitespace is real output; call sites check emptiness.
  return parts.join('\n');
}

export interface ParsedAssistantTurn {
  thinking?: string;
  toolCalls: ToolCallData[];
  textParts: string[];
  /** Short human intent (omp arguments.i) for the tool calls in this turn. */
  intent?: string;
}

export function parseAssistantContent(content: unknown): ParsedAssistantTurn {
  const parsed = parseMessageBlocks(content);
  const toolCalls = parsed.toolCalls.map((tc) =>
    toToolCallData(tc, {
      streaming: false,
      output: parsed.inlineOutputs.get(tc.id) ?? undefined,
      images: parsed.inlineImages.get(tc.id),
    }),
  );
  return {
    thinking: parsed.thinking,
    toolCalls,
    textParts: parsed.textParts,
    intent: parsed.intent,
  };
}

export { extractUserImageAttachments, extractInlinedTextAttachments };
