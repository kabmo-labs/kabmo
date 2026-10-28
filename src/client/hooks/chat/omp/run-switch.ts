/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Whether the agent hook is looking at a DIFFERENT conversation, and therefore
 * has to drop the run's own bookkeeping (`toolResultsRef`, `lastToolMessageRef`,
 * the activity phrase).
 *
 * The question is not "did the id change" — a first send changes it from nothing
 * to omp's UUID — but "are the frames on screen this conversation's". Three
 * arrivals are NOT a switch:
 *
 * 1. **A spawn adoption** (`new-…` → UUID): the pending chat was this
 *    conversation all along. `isSpawnAdoption` answers it without claiming the
 *    record, so the session-state provider still owns the single migration.
 * 2. **A send that began with no `?sessionId=` at all** — a chat opened from a
 *    workspace, where the URL carries only `?folderId=`. There is no pending id
 *    to compare against, so the record cannot exist; what identifies the arrival
 *    is that the hook is ALREADY attached to the arriving id, because the spawn
 *    path connects the stream before it writes the URL.
 * 3. **The same id again** (a re-render, a metadata refresh).
 *
 * A session merely OPENED from the sidebar satisfies none of them: it is not an
 * adoption, it is not the attached id (nothing dials a session the user only
 * clicked — the mount probe attaches AFTER this effect), and it is not the
 * previous id. So it clears, which is the whole point of the rule.
 *
 * Split out as a pure function because the failure it prevents is silent: the
 * map is emptied mid-turn and every later `tool_execution_update`/`_end` has no
 * target, so the card freezes at `Running` for the rest of the session (measured
 * in `wait.e2e.ts` — the settle spec read `Wait Running` for 30s).
 */

import { isSpawnAdoption } from '@/client/hooks/chat/omp/pending-sessions';

export interface RunSwitchInput {
  /** The session id this hook last prepared its refs for, or null on mount. */
  previous: string | null;
  /** The session id now on screen. */
  sessionId: string;
  /** The session the event stream is attached to, or null when unattached. */
  attached: string | null;
}

/** True when the arriving session is a different conversation. */
export function isRunSwitch({ previous, sessionId, attached }: RunSwitchInput): boolean {
  if (previous === sessionId) return false;
  if (isSpawnAdoption(previous, sessionId)) return false;
  return attached !== sessionId;
}
