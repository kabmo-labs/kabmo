import { isRecord } from '@kabmo-labs/kabmo-guards';
import type { RawMessageInfo, SessionContextTelemetry } from '@/shared/types/context';
import type { OmpMessage, OmpMessageEntry, OmpUsage } from '@kabmo-labs/kabmo-omp-contracts/session';

/** Model context window assumed when a session records none. */
export const CONTEXT_LIMIT = 1_000_000;

/** Flatten an omp content value (string or block array) to plain text. */
export function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const block of content) {
    if (!isRecord(block)) continue;
    if (typeof block.text === 'string') parts.push(block.text);
    else if (typeof block.thinking === 'string') parts.push(block.thinking);
  }
  return parts.join(' ').trim();
}

export function formatTs(ts: string | number | undefined): string {
  if (ts === undefined) return '';
  const date = typeof ts === 'number' ? new Date(ts) : new Date(ts);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('en-US', {
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

export function formatCost(value: number): string {
  return value < 0.01 ? '$0.01' : `$${value.toFixed(2)}`;
}

export function tokensOf(usage: OmpUsage | undefined): {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  reasoning: number;
  total: number;
} {
  const input = usage?.input ?? 0;
  const output = usage?.output ?? 0;
  const cacheRead = usage?.cacheRead ?? 0;
  const cacheWrite = usage?.cacheWrite ?? 0;
  const reasoning = usage?.reasoningTokens ?? 0;
  const total = usage?.totalTokens ?? input + output + cacheRead + cacheWrite;
  return { input, output, cacheRead, cacheWrite, reasoning, total };
}

export function contextAnchorTokens(msg: OmpMessage): number | undefined {
  const snapshot = msg.contextSnapshot;
  const usage = msg.usage;
  let promptTokens: number;
  if (snapshot?.promptTokens !== undefined) promptTokens = snapshot.promptTokens;
  else if (usage?.contextTokens !== undefined && usage.contextTokens > 0) promptTokens = usage.contextTokens;
  else if (usage) promptTokens = (usage.input ?? 0) + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0);
  else return undefined;
  if (promptTokens <= 0) return undefined;
  return Math.max(0, promptTokens - (snapshot?.historyRewriteTokensRemoved ?? 0));
}

export function buildInfo(
  entry: OmpMessageEntry,
  msg: OmpMessage,
  cwd: string,
  index: number,
): RawMessageInfo {
  const usage = tokensOf(msg.usage);
  return {
    id: entry.id ?? `m${index}`,
    parentID: entry.parentId ?? undefined,
    role: msg.role === 'user' ? 'user' : 'assistant',
    path: { cwd, root: cwd },
    cost: msg.usage?.cost?.total ?? 0,
    tokens: {
      total: usage.total,
      input: usage.input,
      output: usage.output,
      reasoning: usage.reasoning,
      cache: { write: usage.cacheWrite, read: usage.cacheRead },
    },
    modelID: msg.provider && msg.model ? `${msg.provider}/${msg.model}` : '',
  };
}

export function emptyTelemetry(sessionId: string, sessionTitle: string, contextLimit: number = CONTEXT_LIMIT): SessionContextTelemetry {
  return {
    sessionId,
    sessionTitle,
    modelId: '',
    modelName: '',
    timestamp: '',
    contextUsed: 0,
    contextLimit,
    contextPercent: 0,
    messagesCount: 0,
    userCount: 0,
    assistantCount: 0,
    totalCost: 0,
    costFormatted: '$0.01',
    lastMessage: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, cacheHitPercent: 0 },
    distribution: { userTokens: 0, userPercent: 0, assistantTokens: 0, assistantPercent: 0, toolTokens: 0, toolPercent: 0, otherTokens: 0, otherPercent: 100 },
    rawMessages: [],
  };
}
