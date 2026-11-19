/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The raw-message rows for an ACP chat.
 *
 * omp's raw panel reads its JSONL, where every entry carries the provider's own
 * token counts, model id and cwd. An ACP agent writes no such file: Kabmo's
 * transcript rows are the only record, and they carry a per-turn `usage` only
 * when the agent reported one. This builder therefore states what the row
 * actually holds and leaves the rest EMPTY — a fabricated model id or token
 * count is worse than a blank, because the panel is the place a user goes to
 * check what the agent really sent.
 *
 * `rawPayload` is the row itself, not a synthesized omp entry: the JSON viewer
 * is the "raw" half of the panel, and it must show the data Kabmo stored.
 */

import type { ChatMessageData } from '@/shared/types/chat';
import type { RawMessageItem } from '@/shared/types/context';

const ZERO_TOKENS = {
  total: 0,
  input: 0,
  output: 0,
  reasoning: 0,
  cache: { write: 0, read: 0 },
};

/** The row's own clock, in the panel's short form. */
function timestampOf(row: ChatMessageData): string {
  if (row.date) return row.date;
  if (row.timestamp) return row.timestamp;
  if (typeof row.startedAt === 'number' && row.startedAt > 0) {
    return new Date(row.startedAt).toLocaleString('en-US', {
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  }
  return '';
}

/** The badge the collapsed row draws: what this turn actually contains. */
function badgeOf(row: ChatMessageData): { type: string; badgeLabel: string } {
  if (row.role === 'user') {
    const snippet = row.content.slice(0, 70);
    return {
      type: 'user',
      badgeLabel: `user: ${snippet}${row.content.length > 70 ? '...' : ''}`,
    };
  }
  const parts: string[] = [];
  if (row.thinking) parts.push('reasoning');
  if (row.content) parts.push('text');
  for (const call of row.toolCalls ?? []) {
    const name = call.name || call.type;
    if (name && !parts.includes(name)) parts.push(name);
  }
  return {
    type: parts.join('_') || 'text',
    badgeLabel: parts.join(' + ') || 'text',
  };
}

export interface AcpRawMessageContext {
  /** The model the session ran, when Kabmo recorded one. */
  modelId?: string;
  /** The session's working directory, when the record has one. */
  cwd?: string;
}

/**
 * One `RawMessageItem` per stored row, oldest first (the route pages and
 * reverses for display, exactly like the omp path).
 */
export function buildAcpRawMessages(
  messages: readonly ChatMessageData[],
  context: AcpRawMessageContext = {},
): RawMessageItem[] {
  return messages.map((row, index) => {
    const role: 'user' | 'assistant' = row.role === 'user' ? 'user' : 'assistant';
    const { type, badgeLabel } = badgeOf(row);
    const usage = row.usage;
    const tokens = usage
      ? {
          total: usage.totalTokens ?? 0,
          input: usage.input ?? 0,
          output: usage.output ?? 0,
          reasoning: usage.reasoningTokens ?? 0,
          cache: { write: usage.cacheWrite ?? 0, read: usage.cacheRead ?? 0 },
        }
      : { ...ZERO_TOKENS, cache: { ...ZERO_TOKENS.cache } };
    const cost = usage?.cost?.total ?? 0;
    const timestamp = timestampOf(row);
    const modelId = row.model || context.modelId || '';
    const toolNames = (row.toolCalls ?? []).map((call) => call.name || call.type).filter(Boolean);
    const info = {
      id: row.id,
      ...(index > 0 ? { parentID: messages[index - 1].id } : {}),
      role,
      modelID: modelId,
      ...(context.cwd ? { path: { cwd: context.cwd, root: context.cwd } } : {}),
      cost,
      tokens,
      ...(row.content ? { contentSnippet: row.content.slice(0, 200) } : {}),
      ...(toolNames.length > 0 ? { toolSummary: toolNames.join(', ') } : {}),
      ...(timestamp ? { timestamp } : {}),
    };
    return {
      id: row.id,
      type,
      badgeLabel,
      // ACP reports usage per SESSION, not per message. A row that carries its
      // own usage prints it; every other row prints nothing rather than a
      // number the agent never sent.
      tokenSummary: tokens.input > 0 || tokens.output > 0
        ? `${tokens.input.toLocaleString()} / ${tokens.output.toLocaleString()}`
        : '',
      timestamp,
      info,
      rawPayload: row as unknown as Record<string, unknown>,
    };
  });
}
