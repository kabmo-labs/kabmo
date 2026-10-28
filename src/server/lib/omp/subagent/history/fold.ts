/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Per-entry roster fold for on-disk subagent history.
 *
 * Each parent `task` toolResult carries `progress` (running snapshots) and
 * `results` (settled telemetry) for the agents it spawned. The factory owns
 * the mutable fold state (`byId`, `batchSeqById`, `detachedIds`, the
 * launch-order counters) so ingestion is a per-entry step; the caller supplies
 * the authoritative call order and walks the session entries in order.
 */

import { isRecord } from '@/shared/lib/util/guards';
import { SUBAGENT_ID_RE } from '@/server/lib/omp/subagent/history/paths';
import { progressStatusToHistory, progressUpsertBlocked, resultStatus } from '@/shared/lib/omp/subagent/history/status';
import { parseSubagentProgress } from '@/shared/lib/omp/subagent/parse';
import { asAgentSource, asNumber, asString, taskResultStructuredOutput, taskResultUsageCost } from '@/shared/lib/omp/subagent/result-details';
import type { OmpMessageEntry } from '@/shared/lib/omp/session/messages-parse';
import type { SubagentHistoryEntry, SubagentHistoryResult } from '@/shared/types/omp/subagent';

/**
 * Mutable roster fold seeded from parent `task` toolResults. `callOrder` is the
 * assistant-message ordinal of each `task` call (see `buildCallOrder` in
 * `@/lib/omp/subagent/history`).
 */
export function createFolder(callOrder: Map<string, number>) {
  const byId = new Map<string, SubagentHistoryEntry>();
  // `index` is the position inside ONE `task` call's batch and restarts at 0 for
  // every call, so sorting by it alone interleaves the agents of separate calls.
  // Pair it with the ordinal of the call that spawned each agent.
  const batchSeqById = new Map<string, number>();
  let batchSeq = -1;
  let unannouncedCalls = 0;
  const upsert = (entry: SubagentHistoryEntry, options?: { ignoreTerminal?: boolean }): void => {
    if (!SUBAGENT_ID_RE.test(entry.id)) return;
    const existing = byId.get(entry.id);
    if (!existing) {
      batchSeqById.set(entry.id, batchSeq);
      byId.set(entry.id, entry);
      return;
    }
    // A stale/duplicate progress snapshot must not regress a settled agent:
    // once a result is recorded (or status went terminal via results), skip
    // the whole overwrite. `ignoreTerminal` opts the results loop out — its
    // own field-by-field guards already make it authoritative.
    if (!options?.ignoreTerminal && progressUpsertBlocked(existing)) return;
    const preservedBatchSeq = batchSeqById.get(entry.id) ?? batchSeq;
    batchSeqById.set(entry.id, preservedBatchSeq);
    byId.set(entry.id, {
      ...existing,
      ...entry,
      parentToolCallId: entry.parentToolCallId ?? existing.parentToolCallId,
      batchSeq: preservedBatchSeq,
      result: entry.result ?? existing.result,
    });
  };

  // Detached async spawns — jobIds collected in the same pass below.
  const detachedIds = new Set<string>();

  const ingest = (entry: OmpMessageEntry): void => {
    const message = entry.message;
    if (entry.type !== 'message' || !message || message.role !== 'toolResult') return;
    if (message.toolName !== 'task') return;
    const toolCallId = asString(message.toolCallId);
    // A result whose call block never made it into the file (truncated or
    // imported session) keeps arrival order, placed after every announced call.
    const announced = toolCallId !== undefined ? callOrder.get(toolCallId) : undefined;
    batchSeq = announced ?? callOrder.size + unannouncedCalls++;
    const details: Record<string, unknown> = isRecord(message.details) ? message.details : {};
    const progressArr = Array.isArray(details.progress) ? details.progress : [];
    const resultsArr = Array.isArray(details.results) ? details.results : [];
    const asyncInfo = isRecord(details.async) ? details.async : undefined;
    const asyncJobId = asyncInfo ? asString(asyncInfo.jobId) : undefined;
    if (asyncJobId) detachedIds.add(asyncJobId);

    for (const raw of progressArr) {
      const progress = parseSubagentProgress(raw);
      if (!progress?.id) continue;
      upsert({
        id: progress.id,
        agent: progress.agent ?? 'subagent',
        agentSource: progress.agentSource,
        status: progressStatusToHistory(progress.status),
        task: progress.task,
        assignment: progress.assignment,
        description: progress.description,
        index: progress.index ?? 0,
        ...(toolCallId !== undefined ? { parentToolCallId: toolCallId } : {}),
        lastIntent: progress.lastIntent,
        toolCount: progress.toolCount,
        requests: progress.requests,
        tokens: progress.tokens,
        contextTokens: progress.contextTokens,
        contextWindow: progress.contextWindow,
        cost: progress.cost,
        durationMs: progress.durationMs,
        modelOverride: progress.modelOverride,
        modelRole: progress.modelRole,
        resolvedModel: progress.resolvedModel,
        resolvedModelIsFallback: progress.resolvedModelIsFallback,
        retryFailure: progress.retryFailure,
        transcriptAvailable: false,
      });
    }

    for (const raw of resultsArr) {
      if (!isRecord(raw)) continue;
      const id = asString(raw.id);
      if (!id) continue;
      const prior = byId.get(id);
      const result: SubagentHistoryResult = {};
      const exitCode = asNumber(raw.exitCode);
      if (exitCode !== undefined) result.exitCode = exitCode;
      // NOTE: `output`/`stderr` are deliberately NOT copied — the roster route
      // must stay telemetry-only (task outputs can be ~500KB per agent).
      if (raw.truncated === true) result.truncated = true;
      const cost = asNumber(raw.cost) ?? taskResultUsageCost(raw.usage);
      if (cost !== undefined) result.cost = cost;
      const structured = taskResultStructuredOutput(raw.structuredOutput);
      if (structured !== undefined) result.structuredOutput = structured;
      const error = asString(raw.error);
      if (error !== undefined) result.error = error;
      if (raw.aborted === true) result.aborted = true;
      const abortReason = asString(raw.abortReason);
      if (abortReason !== undefined) result.abortReason = abortReason;
      const outputPath = asString(raw.outputPath);
      if (outputPath !== undefined) result.outputPath = outputPath;
      const patchPath = asString(raw.patchPath);
      if (patchPath !== undefined) result.patchPath = patchPath;
      const branchName = asString(raw.branchName);
      if (branchName !== undefined) result.branchName = branchName;
      let retryFailure = prior?.retryFailure;
      const retryRaw = raw.retryFailure;
      if (isRecord(retryRaw)) {
        const attempt = asNumber(retryRaw.attempt);
        const errorMessage = asString(retryRaw.errorMessage);
        if (attempt !== undefined && errorMessage !== undefined) retryFailure = { attempt, errorMessage };
      }
      const modelOverride = typeof raw.modelOverride === 'string'
        ? raw.modelOverride
        : Array.isArray(raw.modelOverride) && raw.modelOverride.every((model): model is string => typeof model === 'string')
          ? raw.modelOverride
          : prior?.modelOverride;
      upsert({
        id,
        agent: asString(raw.agent) ?? prior?.agent ?? 'subagent',
        agentSource: asAgentSource(raw.agentSource) ?? prior?.agentSource,
        status: resultStatus(raw),
        task: asString(raw.task) ?? prior?.task,
        assignment: asString(raw.assignment) ?? prior?.assignment,
        description: asString(raw.description) ?? prior?.description,
        index: asNumber(raw.index) ?? prior?.index ?? 0,
        ...(toolCallId !== undefined ? { parentToolCallId: toolCallId } : {}),
        lastIntent: asString(raw.lastIntent) ?? prior?.lastIntent,
        toolCount: asNumber(raw.toolCount) ?? prior?.toolCount,
        requests: asNumber(raw.requests) ?? prior?.requests,
        tokens: asNumber(raw.tokens) ?? prior?.tokens,
        contextTokens: asNumber(raw.contextTokens) ?? prior?.contextTokens,
        contextWindow: asNumber(raw.contextWindow) ?? prior?.contextWindow,
        cost: asNumber(raw.cost) ?? taskResultUsageCost(raw.usage) ?? prior?.cost,
        durationMs: asNumber(raw.durationMs) ?? prior?.durationMs,
        modelOverride,
        modelRole: asString(raw.modelRole) ?? prior?.modelRole,
        resolvedModel: asString(raw.resolvedModel) ?? prior?.resolvedModel,
        resolvedModelIsFallback: typeof raw.resolvedModelIsFallback === 'boolean'
          ? raw.resolvedModelIsFallback
          : prior?.resolvedModelIsFallback,
        retryFailure,
        transcriptAvailable: false,
        result: Object.keys(result).length > 0 ? result : undefined,
      }, { ignoreTerminal: true });
    }

    // Detached async spawns can persist with an empty results[] while still
    // running — async.jobId still names the agent.
    if (asyncInfo) {
      const jobId = asString(asyncInfo.jobId);
      if (jobId && !byId.has(jobId)) {
        upsert({
          id: jobId,
          agent: 'task',
          status: asyncInfo.state === 'completed' ? 'completed' : asyncInfo.state === 'failed' ? 'failed' : 'started',
          index: byId.size,
          ...(toolCallId !== undefined ? { parentToolCallId: toolCallId } : {}),
          transcriptAvailable: false,
        }, { ignoreTerminal: true });
      }
    }
  };

  return { byId, batchSeqById, detachedIds, ingest };
}
