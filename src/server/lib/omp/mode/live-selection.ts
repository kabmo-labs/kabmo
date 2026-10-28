/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The plan/goal selection of a session that is ALIVE but has no transcript yet.
 *
 * omp writes the session JSONL at its first ASSISTANT message, not at spawn, so
 * a new chat spends its first seconds-to-minutes with a live child and no file.
 * During that window the file-based read has nothing to answer from, and the
 * console's hydration (`useChatTimelineModes`) treats the resulting 404 as
 * "no modes" — which resets the very toggles the user just pressed. Measured on
 * a real spawn: the file appeared 40 s after the id was adopted, so a Plan
 * toggle made in between was undone in the composer while the child was
 * demonstrably in plan mode.
 *
 * Two sources answer for the child, and neither can drift from it:
 *
 *  - the wrapper's `ModeMirror`, fed by the extension's own `KABMO_*` markers
 *    and by omp's `goal_updated`;
 *  - the spawn environment (`KABMO_MODES`), which is the selection the child
 *    was started with and which its extension re-applies at session start.
 *
 * `spoken` says whether the child itself has reported a mode. It is what the
 * caller uses to decide between these and a transcript that already exists:
 * the child's word is newer than any entry the file holds (a toggle moves the
 * child, and the append that records it lands a moment later), while an
 * unreported child is described better by the file than by the environment it
 * happened to be spawned with.
 */

import { getRpcSession, getSpawnModeEnv } from '@/server/lib/omp/rpc/manager';
import { selectionFromModeEnvValue } from '@/server/lib/omp/mode/request';
import type { PersistedModes } from '@/server/lib/omp/session/modes';
import { isGoalOpen, isGoalStatus } from '@/shared/lib/omp/mode/status';

export interface LiveModeSelection {
  modes: PersistedModes;
  /** True once the child has reported a mode itself (a marker, or a
   *  `goal_updated` frame) — as opposed to the selection it was spawned with. */
  spoken: boolean;
}

/**
 * The mode selection of the live child running `sessionId`, or null when this
 * process holds no live child for it.
 */
export function liveModeSelection(sessionId: string): LiveModeSelection | null {
  const session = getRpcSession(sessionId);
  if (!session || !session.isAlive()) return null;

  const mirror = session.modeMirror;
  // Both env spellings: this build exports `KABMO_MODES`, and a child spawned
  // by an older one carries `CHAMBER_MODES`.
  const env = getSpawnModeEnv(session);
  const spawned = selectionFromModeEnvValue(env.KABMO_MODES ?? env.CHAMBER_MODES);
  // The child has spoken if EITHER feed produced anything: a `KABMO_*` marker
  // (plan, or a goal record) or omp's own `goal_updated` (a goal status).
  const spoken =
    mirror.planEnabled !== undefined || mirror.goalRecord !== null || mirror.goalStatus !== undefined;
  const plan = mirror.planEnabled ?? spawned.plan;
  const record = mirror.goalRecord;
  // A goal this chat no longer owns (`complete`/`dropped`) is reported as OFF
  // even while its record travels: the composer's strip and button gate on the
  // same question (`isGoalOpen`), and a closed goal must not re-open them. With
  // no record at all, the child's own `goal_updated` status decides — and a
  // status this build does not know reads as OFF rather than as an open goal.
  const goal = record
    ? isGoalOpen(record.status)
    : isGoalStatus(mirror.goalStatus)
      ? isGoalOpen(mirror.goalStatus)
      : spawned.goal;

  return {
    spoken,
    modes: {
      plan,
      goal,
      // The file reader's rule, applied to the mirror: only an ENABLED goal is
      // being pursued, and only `active` is a goal actually working (paused and
      // budget-limited stay open but idle, which is what arms the continuation
      // loop).
      goalLive: mirror.goalEnabled && record?.status === 'active',
      goalRecord: record,
      goalContinuation: mirror.goalContinuation,
      goalMaxTurns: mirror.goalMaxTurns,
    },
  };
}
