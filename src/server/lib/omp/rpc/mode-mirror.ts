/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The wrapper's mirror of omp's plan/goal modes.
 *
 * Two facts make a mirror necessary rather than a passthrough:
 *
 *  - `get_state` does not carry either mode, so a reattaching client (a reload,
 *    a second tab) has nothing to read the mode from;
 *  - and the mode is not a client preference — it decides whether the child is
 *    running a goal Kabmo must keep feeding, and whether a plan is parked
 *    waiting for a human.
 *
 * The mirror is fed by two frames, and they cover different halves:
 *
 *  - omp's own `goal_updated` session event, which is authoritative for the
 *    goal: whatever Kabmo last asked for, the frame reports what the
 *    child actually did;
 *  - Kabmo's mode extension and its `KABMO_*` notice markers, which are the ONLY
 *    live word on PLAN mode (omp emits no plan event at all) and the only place
 *    a goal RECORD — objective, status, continuation verdict — is carried.
 *
 * The second feed is what makes a session readable before its transcript
 * exists: omp writes the JSONL at the first assistant message, so for the first
 * seconds-to-minutes of a new chat the file-based read has nothing while the
 * child is demonstrably in the mode the user just picked. See
 * `liveModeSelection`.
 */

import type { AgentEvent } from '@/server/lib/omp/rpc/constants';
import {
  type GoalContinuation,
  type GoalRecord,
} from '@/shared/lib/omp/mode/types';
import { isModeMarker } from '@/shared/lib/omp/mode/constants';
import { continuationFromMarker, goalEnabledFromMarker, goalRecordFromMarker, type ParsedMarker } from '@/shared/lib/omp/mode/markers';
import { isGoalStatus } from '@/shared/lib/omp/mode/status';
import type { GoalStatus } from '@/shared/lib/omp/mode/types';

/** Statuses that mean the goal is still being pursued. `budget-limited` counts:
 *  it is a resumable state omp returns to `active` when the budget is raised. */
const LIVE_STATUSES = new Set(['active', 'budget-limited']);

export class ModeMirror {
  /** True only while a goal is live. A paused or completed goal keeps its
   *  record in the transcript but is not work in progress. */
  goalEnabled = false;
  goalStatus: GoalStatus | undefined;
  /** The plan flag the extension last reported. `undefined` means no marker has
   *  been seen — NOT "off", which is what keeps the spawn environment usable as
   *  the fallback. */
  planEnabled: boolean | undefined;
  /** The goal record the last `CHAMBER_GOAL_STATE` carried, for the window in
   *  which there is no transcript to read it back from. */
  goalRecord: GoalRecord | null = null;
  /** The auto-continuation verdict the loop last reported, and the ceiling that
   *  rode with it. */
  goalContinuation: GoalContinuation | null = null;
  goalMaxTurns: number | null = null;

  /** Apply one `goal_updated` frame. */
  observe(event: AgentEvent): void {
    const state = event.state as { enabled?: boolean; goal?: { status?: unknown } } | undefined;
    const goal = event.goal as { status?: unknown } | null | undefined;
    const status = state?.goal?.status ?? goal?.status;
    // A status this build does not know is not a status: storing it would make
    // every downstream `isGoalOpen` call a cast, and an unknown value must read
    // as "no goal" rather than as an open one.
    this.goalStatus = isGoalStatus(status) ? status : undefined;
    this.goalEnabled =
      state?.enabled === true && this.goalStatus !== undefined && LIVE_STATUSES.has(this.goalStatus);
  }

  /**
   * Apply one extension notice marker.
   *
   * Markers only, never a `KABMO_MODE_ERROR` or a plan proposal: those are
   * refusals and review state, not the selection. A marker for the other scope
   * leaves this one alone — the two toggles are independent, and a plan
   * transition that blanked the goal record would make a live goal disappear
   * from a reattaching client.
   */
  observeMarker(marker: ParsedMarker): void {
    if (isModeMarker(marker.marker, 'planStateMarker')) {
      this.planEnabled = marker.payload.enabled === true;
      return;
    }
    if (!isModeMarker(marker.marker, 'goalStateMarker')) return;
    const record = goalRecordFromMarker(marker.payload);
    this.goalRecord = record;
    this.goalStatus = record && isGoalStatus(record.status) ? record.status : undefined;
    // The same rule `observe` applies, from the payload that carries the record
    // rather than from a `goal_updated` frame — so both feeds agree on what
    // "live" means instead of each having its own spelling.
    this.goalEnabled =
      goalEnabledFromMarker(marker.payload) &&
      this.goalStatus !== undefined &&
      LIVE_STATUSES.has(this.goalStatus);
    if ('continuation' in marker.payload) {
      this.goalContinuation =
        marker.payload.continuation === null ? null : continuationFromMarker(marker.payload.continuation);
    }
    const ceiling = marker.payload.maxTurns;
    if (typeof ceiling === 'number' && Number.isInteger(ceiling) && ceiling > 0) this.goalMaxTurns = ceiling;
  }
}
