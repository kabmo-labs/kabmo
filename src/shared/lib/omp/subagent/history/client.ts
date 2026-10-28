/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Client helpers for the on-disk subagent history route
 * (`GET /api/sessions/:id/subagents`): wire normalization, history → roster
 * mapping, and the compact row formatters.
 */

import { isRecord } from '@/shared/lib/util/guards';
import type { SubagentHistoryEntry, SubagentInfo, SubagentProgress } from '@/shared/types/omp/subagent';

/** Minimal wire guard — a malformed element must not become a roster row. */
function isHistoryEntry(value: unknown): value is SubagentHistoryEntry {
  return isRecord(value)
    && typeof value.id === 'string' && value.id.length > 0
    && typeof value.agent === 'string' && value.agent.length > 0
    && typeof value.status === 'string'
    && typeof value.index === 'number';
}

/** Fetch the recovered roster for a session. `null` = unavailable/failed. */
export async function fetchSubagentHistory(sessionId: string): Promise<SubagentHistoryEntry[] | null> {
  try {
    const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/subagents`);
    if (!res.ok) return null;
    const body: unknown = await res.json().catch(() => null);
    if (!isRecord(body)) return null;
    const payload = isRecord(body.data) ? body.data : body;
    if (!Array.isArray(payload.subagents)) return null;
    return payload.subagents.filter(isHistoryEntry);
  } catch {
    return null;
  }
}

/** Convert a recovered on-disk history entry into roster form. `lastUpdate: 0`
 *  marks it infinitely old, so any live frame wins in `mergeSubagentRoster`. */
export function historyEntryToSubagentInfo(entry: SubagentHistoryEntry): SubagentInfo {
  const info: SubagentInfo = { ...entry, source: 'history', lastUpdate: 0 };
  const progress: SubagentProgress = {};
  if (entry.lastIntent !== undefined) progress.lastIntent = entry.lastIntent;
  if (entry.toolCount !== undefined) progress.toolCount = entry.toolCount;
  if (entry.requests !== undefined) progress.requests = entry.requests;
  if (entry.tokens !== undefined) progress.tokens = entry.tokens;
  if (entry.contextTokens !== undefined) progress.contextTokens = entry.contextTokens;
  if (entry.contextWindow !== undefined) progress.contextWindow = entry.contextWindow;
  if (entry.cost !== undefined) progress.cost = entry.cost;
  if (entry.durationMs !== undefined) progress.durationMs = entry.durationMs;
  if (entry.resolvedModel !== undefined) progress.resolvedModel = entry.resolvedModel;
  if (Object.keys(progress).length > 0) info.progress = progress;
  return info;
}

/** ms → `17.8s` / `1m 4s`; empty for absent/negative values. */
export function formatSubagentDuration(ms: number | undefined): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return '';
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const totalSeconds = Math.round(ms / 1000);
  return `${Math.floor(totalSeconds / 60)}m ${totalSeconds % 60}s`;
}

/** `$0.003` compact cost; empty for absent/zero values. */
export function formatSubagentCost(cost: number | undefined): string {
  if (typeof cost !== 'number' || !Number.isFinite(cost) || cost <= 0) return '';
  return `$${cost.toFixed(3)}`;
}

/** Combined `duration · cost` row suffix, sourced from the roster progress. */
export function formatSubagentMeta(subagent: SubagentInfo): string {
  const duration = formatSubagentDuration(subagent.progress?.durationMs);
  const cost = formatSubagentCost(subagent.progress?.cost);
  return [duration, cost].filter(Boolean).join(' · ');
}
