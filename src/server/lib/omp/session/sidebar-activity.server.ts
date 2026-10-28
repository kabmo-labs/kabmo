/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The `sidebar:activity` resolver: the two row fields a RUNNING session can
 * still move between turn boundaries.
 *
 * Split out of `sidebar-data.server.ts` (which owns the structure and the
 * status) because it answers a different question at a different cadence: the
 * structure is re-scanned at turn boundaries, while this is resolved on every
 * tool call — and its whole reason to exist is that the structure must NOT be.
 *
 * A run appends to its transcript on every tool call, so its row's age and its
 * `LATEST_SESSION` position move mid-run. Republishing the structure for that
 * cost 216 KB over 731 sessions per tool call (measured on the author's
 * install, against 87 bytes for one live entry here), which is what made a
 * phone's stream feel slow. Only a RUNNING session can move between boundaries,
 * so only those are carried.
 *
 * A live run with no session FILE yet (a fresh spawn: omp writes it only when
 * the first assistant message settles) contributes nothing — there is no stamp
 * to report, and its sidebar row is the client's pending row until the scan
 * finds the file.
 */

import { isMockMode } from '@/server/mock.server';
import { getLiveRunSessionIds } from '@/server/lib/omp/rpc/session-registry';
import { findSessionFileById } from '@/server/lib/omp/session/locator';
import { scanSessionInfoCached } from '@/server/lib/omp/session/files';
import { sessionHasSubagents } from '@/server/lib/omp/session/subagent-presence';
import type { SidebarActivityPayload } from '@/shared/types/realtime';

export async function loadSidebarActivity(): Promise<SidebarActivityPayload> {
  const activity: SidebarActivityPayload = {};
  // MOCK answers nothing, and that is not a shortcut: the simulated stream is
  // an SSE route, not an omp child, so no `tool_execution_end` frame ever fires
  // there and there is no between-boundary movement to report. Its rows also
  // read `created_at` (the mock `sessions` table has no `updated_at`), so a
  // `chat_sessions` stamp would be a different quantity under the same name —
  // the one thing this payload must never be.
  if (isMockMode()) return activity;

  const live = getLiveRunSessionIds();
  if (live.size === 0) return activity;
  const entries = await Promise.all(
    [...live].map(async (sessionId) => {
      const filePath = await findSessionFileById(sessionId);
      if (!filePath) return null;
      const info = await scanSessionInfoCached(filePath);
      if (!info) return null;
      // `modified` is the newest entry's own timestamp, which is what the
      // structure ships as `updated_at` — the same quantity, so the client can
      // compare the two as ISO strings.
      const updatedAt = info.modified.toISOString();
      // The chevron's flag moves mid-run too: a subagent writes its own
      // transcript beside the parent, and the row it lights is the parent's.
      // Cost is a stat plus (on a change) one readdir, and the presence module
      // memoizes on `(last entry, sibling mtime)` — measured 4-8 ms on a cache
      // miss, 0 on a hit.
      const hasSubagents = await sessionHasSubagents(filePath, updatedAt);
      return [sessionId, { updatedAt, hasSubagents }] as const;
    }),
  );
  for (const entry of entries) {
    if (entry) activity[entry[0]] = entry[1];
  }
  return activity;
}
