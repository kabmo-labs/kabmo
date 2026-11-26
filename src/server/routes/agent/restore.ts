/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * `POST /api/agent/:id { type: 'restore' }` — copy an imported chat's history in.
 *
 * The command exists because opening a discovered chat is not opening a file:
 * the agent holds the transcript, and only a resume with `replayFrom` can hand
 * it over. Split from `command.ts` so the dispatcher keeps one branch per line
 * and the rules read as a sentence:
 *
 *  - a LIVE session has nothing to replay (its frames already reached Kabmo);
 *  - an unrecorded id is refused by name, never guessed at;
 *  - a failure is the agent's own words, because an empty timeline is
 *    indistinguishable from a lost conversation.
 */

import { json } from '@kabmo-labs/kabmo-http';
import { getLiveSession, harnessOfSession } from '@/server/lib/omp/rpc/session-registry';
import { loadPersistedAccessMode } from '@/shared/lib/omp/config/access-mode.server';
import { restoreRecordedHarnessSession } from '@/server/routes/agent/harness-command';
import type { ApprovalMode } from '@kabmo-labs/kabmo-omp/access-mode';

export async function restoreChatResponse(
  sessionId: string,
  explicitMode: ApprovalMode | null,
): Promise<Response> {
  const live = getLiveSession(sessionId);
  if (live?.isAlive()) {
    return json({ success: true, data: { restored: false, harness: harnessOfSession(live), messages: 0 } });
  }
  const accessMode = explicitMode ?? await loadPersistedAccessMode();
  try {
    const restored = await restoreRecordedHarnessSession(sessionId, accessMode);
    if (!restored) {
      return json(
        { error: 'This chat has no imported history to replay', code: 'restore_unavailable' },
        { status: 404 },
      );
    }
    return json({ success: true, data: { restored: true, harness: restored.harness, messages: restored.messages } });
  } catch (cause) {
    return json(
      { error: cause instanceof Error ? cause.message : 'Could not replay this chat', code: 'restore_failed' },
      { status: 400 },
    );
  }
}
