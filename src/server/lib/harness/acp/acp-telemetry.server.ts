/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The context panel's numbers for an ACP chat.
 *
 * omp computes telemetry from its transcript; another agent writes no file and
 * only reports `usage_update` — context size, tokens in use and a cost. Those
 * are exactly the figures the ring and the panel open on, so the live session is
 * the source and the panel reads the same shape it always has.
 *
 * Fields ACP does not report (per-turn cache split, the token distribution, the
 * last message's input/output) stay ZERO rather than invented. The panel draws
 * its empty state from `messagesCount`, so a chat with usage still shows the
 * window and the cost, and a chat with neither says it is not started.
 */

import type { SessionContextTelemetry } from '@/shared/types/context';
import { getDb } from '@/server/db.server';

/** What the live session exposes for this bridge. */
export interface AcpTelemetrySession {
  sessionId: string;
  messageCount: number;
  promptCount: number;
  assistantCount: number;
  contextUsage: { tokens: number; contextWindow: number; percent: number } | null;
  totalCost: number;
  runModel: { provider: string; modelId: string } | null;
}

const ZERO_LAST = { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, cacheHitPercent: 0 };

const ZERO_DISTRIBUTION = {
  userTokens: 0,
  userPercent: 0,
  assistantTokens: 0,
  assistantPercent: 0,
  toolTokens: 0,
  toolPercent: 0,
  otherTokens: 0,
  otherPercent: 0,
};

/** The last usage an ACP session reported, for a chat whose process is gone. */
export interface StoredAcpUsage extends AcpTelemetrySession {}

export async function saveAcpUsage(session: AcpTelemetrySession): Promise<void> {
  try {
    const db = await getDb();
    await db.run(
      `INSERT INTO harness_usage_state
         (session_id, used, size, cost, messages, prompts, assistants, model_provider, model_id, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(session_id) DO UPDATE SET
         used = excluded.used,
         size = excluded.size,
         cost = excluded.cost,
         messages = excluded.messages,
         prompts = excluded.prompts,
         assistants = excluded.assistants,
         model_provider = excluded.model_provider,
         model_id = excluded.model_id,
         updated_at = excluded.updated_at`,
      [
        session.sessionId,
        session.contextUsage?.tokens ?? 0,
        session.contextUsage?.contextWindow ?? 0,
        session.totalCost,
        session.messageCount,
        session.promptCount,
        session.assistantCount,
        session.runModel?.provider ?? '',
        session.runModel?.modelId ?? '',
        Date.now(),
      ],
    );
  } catch {
    // Best-effort: a write failure must not break a turn's settle.
  }
}

export async function loadAcpUsage(sessionId: string): Promise<StoredAcpUsage | null> {
  try {
    const db = await getDb();
    const row = await db.get('SELECT * FROM harness_usage_state WHERE session_id = ?', [sessionId]);
    if (!row) return null;
    const used = typeof row.used === 'number' ? row.used : 0;
    const size = typeof row.size === 'number' ? row.size : 0;
    return {
      sessionId,
      messageCount: typeof row.messages === 'number' ? row.messages : 0,
      promptCount: typeof row.prompts === 'number' ? row.prompts : 0,
      assistantCount: typeof row.assistants === 'number' ? row.assistants : 0,
      contextUsage: size > 0 ? { tokens: used, contextWindow: size, percent: Math.min(100, Math.round((used / size) * 100)) } : null,
      totalCost: typeof row.cost === 'number' ? row.cost : 0,
      runModel: row.model_provider && row.model_id
        ? { provider: String(row.model_provider), modelId: String(row.model_id) }
        : null,
    };
  } catch {
    return null;
  }
}

/** A snapshot in the shape `SessionContextTelemetry` already defines. */
export function buildAcpTelemetry(
  session: AcpTelemetrySession,
  title: string | null | undefined,
): SessionContextTelemetry {
  const usage = session.contextUsage;
  const model = session.runModel;
  return {
    sessionId: session.sessionId,
    sessionTitle: title?.trim() || 'Session',
    modelId: model ? `${model.provider}/${model.modelId}` : '',
    modelName: model?.modelId ?? '',
    timestamp: new Date().toISOString(),
    contextUsed: usage?.tokens ?? 0,
    contextLimit: usage?.contextWindow ?? 0,
    contextPercent: usage?.percent ?? 0,
    messagesCount: session.messageCount,
    userCount: session.promptCount,
    assistantCount: session.assistantCount,
    totalCost: session.totalCost,
    costFormatted: `$${session.totalCost.toFixed(4)}`,
    lastMessage: { ...ZERO_LAST },
    distribution: { ...ZERO_DISTRIBUTION },
    rawMessages: [],
  };
}
