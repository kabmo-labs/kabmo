/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Settlement folding for detached async subagent spawns.
 *
 * A parent `task` toolResult persists only the launch snapshot
 * (`async.state = "running"`); terminal state arrives later as an
 * `async-result` custom message or a `hub` `jobs` snapshot, so without folding
 * those onto the roster seeded by `@/lib/omp/subagent/history/fold` the agent
 * stays "started" forever.
 */

import { extractText } from '@/shared/lib/omp/session/parse-message-blocks';
import { isRecord } from '@/shared/lib/util/guards';
import { resultStatus } from '@/shared/lib/omp/subagent/history/status';
import { asNumber, asString } from '@/shared/lib/omp/subagent/result-details';
import type { OmpMessageEntry } from '@/shared/lib/omp/session/messages-parse';
import type { SubagentHistoryEntry } from '@/shared/types/omp/subagent';

/** Settled state reported by a detached async spawn. The parent's task
 *  toolResult persists only the launch snapshot (`async.state = "running"`);
 *  settlement arrives later as an `async-result` custom message or a `hub`
 *  `jobs` snapshot, so without folding those the roster stays "started". */
export function applySettlement(
  byId: Map<string, SubagentHistoryEntry>,
  patch: Pick<SubagentHistoryEntry, 'id' | 'status'> & Partial<SubagentHistoryEntry>,
): void {
  const existing = byId.get(patch.id);
  if (!existing) return;
  byId.set(patch.id, {
    ...existing,
    ...patch,
    task: patch.task ?? existing.task,
    assignment: patch.assignment ?? existing.assignment,
    description: patch.description ?? existing.description,
    index: existing.index,
    parentToolCallId: existing.parentToolCallId ?? patch.parentToolCallId,
    batchSeq: existing.batchSeq,
    result: { ...existing.result, ...patch.result },
  });
}

/**
 * Fold `async-result` custom messages and `hub` op="jobs" toolResults onto the
 * roster entries seeded by the history fold.
 */
export function foldSettlements(entries: OmpMessageEntry[], byId: Map<string, SubagentHistoryEntry>): void {
  // Settlement for detached async spawns arrives as `async-result` custom
  // messages (`details.jobs[]` snapshots) and `hub` op="jobs" toolResults —
  // fold their terminal status onto the roster entries seeded above.
  for (const entry of entries) {
    const details = isRecord(entry.details) ? entry.details : undefined;
    if (entry.type === 'custom_message' && entry.customType === 'async-result') {
      const contentText = extractText(entry.content);
      const inlineStatus = /<task-result\b[^>]*\bstatus="(completed|failed|aborted)"/.exec(contentText)?.[1];
      if (details && Array.isArray(details.jobs)) {
        for (const raw of details.jobs) {
          if (!isRecord(raw)) continue;
          const jobId = asString(raw.jobId) ?? asString(raw.id);
          if (!jobId) continue;
          const settled = resultStatus(raw) !== 'started' ? resultStatus(raw)
            : inlineStatus === 'completed' ? 'completed' : 'started';
          if (settled === 'started') continue;
          applySettlement(byId, {
            id: jobId,
            agent: asString(raw.agent) ?? 'task',
            status: settled,
            durationMs: asNumber(raw.durationMs),
            resolvedModel: asString(raw.resolvedModel),
            transcriptAvailable: false,
            result: { exitCode: 0 },
          });
        }
        continue;
      }
      const inlineId = /<task-result\b[^>]*\bid="([A-Za-z0-9_.-]+)"/.exec(contentText)?.[1];
      if (inlineId && inlineStatus) {
        applySettlement(byId, {
          id: inlineId,
          agent: 'task',
          status: inlineStatus as SubagentHistoryEntry['status'],
          transcriptAvailable: false,
          result: { exitCode: 0 },
        });
      }
      continue;
    }
    const message = entry.message;
    if (entry.type !== 'message' || !message || message.role !== 'toolResult') continue;
    if (message.toolName !== 'hub') continue;
    const hubDetails = isRecord(message.details) ? message.details : {};
    if (!Array.isArray(hubDetails.jobs)) continue;
    for (const raw of hubDetails.jobs) {
      if (!isRecord(raw)) continue;
      const jobId = asString(raw.id) ?? asString(raw.jobId);
      if (!jobId) continue;
      const settled = resultStatus(raw);
      if (settled === 'started') continue;
      applySettlement(byId, {
        id: jobId,
        agent: 'task',
        status: settled,
        durationMs: asNumber(raw.durationMs),
        resolvedModel: asString(raw.resolvedModel),
        transcriptAvailable: false,
        result: { exitCode: 0 },
      });
    }
  }
}
