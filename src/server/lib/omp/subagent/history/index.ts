/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * On-disk subagent history recovery for oh-my-pi sessions.
 *
 * omp writes each subagent's transcript to the PARENT session's sibling
 * artifacts directory: `<session-dir>/<subagent-id>.jsonl`. The parent's task
 * toolResult `details` persist `progress` (running snapshots) and `results`
 * (settled telemetry), so the roster survives a reload without the live RPC
 * registry — which only knows currently-running subagents.
 *
 * Ported from omp-web/lib/subagent-history.ts; path helpers live in
 * `@/lib/omp/subagent/history/paths`, status projection in `history/status`,
 * the per-entry toolResult fold in `history/fold`, async settlement in
 * `history/settlement`, and byte-window transcript paging in
 * `@/lib/omp/subagent/history/transcript`.
 */

import { join } from 'path';
import { parseJsonlLenient } from '@/shared/lib/omp/session/jsonl';
import { isRecord } from '@/shared/lib/util/guards';
import { createFolder } from '@/server/lib/omp/subagent/history/fold';
import { SUBAGENT_ID_RE, siblingDirForSession } from '@/server/lib/omp/subagent/history/paths';
import { foldSettlements } from '@/shared/lib/omp/subagent/history/settlement';
import { asString } from '@/shared/lib/omp/subagent/result-details';
import type { OmpMessageEntry } from '@/shared/lib/omp/session/messages-parse';
import type { SubagentHistoryEntry } from '@/shared/types/omp/subagent';

/** Byte cap on the parent session file parsed for history (chat reload cap). */
const MAX_HISTORY_SESSION_BYTES = 512 * 1024 * 1024;

/** Read + lenient-parse every JSONL entry of a session file (bounded). */
async function loadSessionEntries(sessionFilePath: string): Promise<OmpMessageEntry[]> {
  const file = Bun.file(sessionFilePath);
  try {
    if ((await file.stat()).size > MAX_HISTORY_SESSION_BYTES) return [];
  } catch {
    return [];
  }
  try {
    return parseJsonlLenient<OmpMessageEntry>(await file.text());
  } catch {
    return [];
  }
}

/** Build the authoritative launch order of the session's `task` toolCall
 *  blocks, keyed by call id and valued by the ordinal of the assistant
 *  message that issued them. */
function buildCallOrder(entries: OmpMessageEntry[]): Map<string, number> {
  const callOrder = new Map<string, number>();
  // Authoritative launch order: the assistant message that spawns a batch lists
  // its `task` toolCall blocks in the order the model issued them. Ordering by
  // toolResult arrival instead would misplace parallel calls, whose results are
  // appended as each one finishes rather than as each one started.
  for (const entry of entries) {
    const message = entry.message;
    if (entry.type !== 'message' || !message || message.role !== 'assistant') continue;
    const content = message.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (!isRecord(block) || block.type !== 'toolCall' || block.name !== 'task') continue;
      const callId = asString(block.id);
      if (callId !== undefined && !callOrder.has(callId)) callOrder.set(callId, callOrder.size);
    }
  }
  return callOrder;
}

/**
 * Recover the subagent roster from a parent session file. Walks task
 * toolResults, merging `progress` (live-snapshot fields) with `results`
 * (settled per-subagent telemetry), then resolves sibling transcript files.
 */
export async function extractSubagentHistory(sessionFilePath: string): Promise<SubagentHistoryEntry[]> {
  const entries = await loadSessionEntries(sessionFilePath);
  if (entries.length === 0) return [];

  const callOrder = buildCallOrder(entries);
  const folder = createFolder(callOrder);
  for (const entry of entries) folder.ingest(entry);
  foldSettlements(entries, folder.byId);

  // Resolve sibling transcript files and detached markers.
  const { byId, batchSeqById, detachedIds } = folder;
  const dir = siblingDirForSession(sessionFilePath);
  const roster = [...byId.values()];
  for (const entry of roster) {
    // The client cannot derive this: neither a live snapshot nor a partial
    // history fetch reveals which call came first.
    entry.batchSeq = batchSeqById.get(entry.id) ?? 0;
    if (detachedIds.has(entry.id)) entry.detached = true;
    if (!SUBAGENT_ID_RE.test(entry.id)) continue;
    // Guard against crafted ids probing outside the sibling dir (e.g. "../");
    // the path is derived from untrusted session content.
    const candidate = join(dir, `${entry.id}.jsonl`);
    if (await Bun.file(candidate).exists()) {
      entry.sessionFile = candidate;
      entry.transcriptAvailable = true;
    }
  }
  return roster.sort((a, b) =>
    (batchSeqById.get(a.id) ?? 0) - (batchSeqById.get(b.id) ?? 0)
    || a.index - b.index
    || a.id.localeCompare(b.id),
  );
}
