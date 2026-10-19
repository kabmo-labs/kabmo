/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Reading Kabmo's persisted mode selection back off a session.
 *
 * The extension appends one `custom` entry per mode transition
 * (`kabmo-plan-state`, `kabmo-goal-state`), so the session's own JSONL is
 * the durable record — and it is the only one that survives a Kabmo restart,
 * a second Kabmo instances, and a session the CLI itself has been driving.
 *
 * Reading it is a full parse of the same records the transcript loader already
 * walks (`loadSessionMessages`), so this module shares the lenient JSONL
 * reader rather than opening a second, differently-behaved one. Only the LAST
 * record of each type matters: the entries are a transition log, and the newest
 * one is the state the session was left in.
 */

import { parseJsonlLenient } from '@/shared/lib/omp/session/jsonl';
import { isGoalOpen } from '@/shared/lib/omp/mode/status';
import {
  CHAMBER_GOAL_STATE_ENTRY,
  CHAMBER_PLAN_STATE_ENTRY,
  GOAL_CONTINUATION_STOPS,
  KABMO_GOAL_STATE_ENTRY,
  KABMO_PLAN_STATE_ENTRY,
  type GoalContinuation,
  type GoalRecord,
} from '@/shared/lib/omp/mode/types';

export interface PersistedModes {
  plan: boolean;
  goal: boolean;
  /**
   * Whether the goal was being PURSUED when the session stopped — as opposed to
   * merely existing (paused, complete, dropped).
   *
   * The distinction is what decides whether a cold spawn arms automatic
   * continuation. omp pauses an active goal when a thread is resumed
   * unattended, so arming the loop from `goal: true` alone would override that
   * decision and start spending tokens the moment someone opened the tab.
   */
  goalLive: boolean;
  /** The last goal record, when the session carries one. */
  goalRecord: GoalRecord | null;
  /**
   * The auto-continuation loop's last verdict, when the session carries one.
   *
   * Without it a reload cannot tell that the loop STOOD DOWN: the turn count
   * lives in the child's memory, so the composer would render a goal as active
   * with nothing left to run it. `null` when the loop has not reported, or after
   * a Resume cleared the count.
   */
  goalContinuation: GoalContinuation | null;
  /**
   * The goal's OWN automatic-turn ceiling, persisted when it was created.
   * Absent means the install default (`CHAMBER_GOAL_MAX_TURNS`) applies.
   */
  goalMaxTurns: number | null;
}

const NONE: PersistedModes = {
  plan: false,
  goal: false,
  goalLive: false,
  goalRecord: null,
  goalContinuation: null,
  goalMaxTurns: null,
};

function isGoalRecord(value: unknown): value is GoalRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return typeof record.id === 'string' && typeof record.objective === 'string' && typeof record.status === 'string';
}

/** A reported verdict, or null for anything malformed — the same rule the
 *  console's marker reader applies, so a skew shows nothing rather than an
 *  invented turn number. */
function goalContinuationOf(value: unknown): GoalContinuation | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const turn = record.turn;
  const maxTurns = record.maxTurns;
  if (typeof turn !== 'number' || !Number.isInteger(turn) || turn < 1) return null;
  if (typeof maxTurns !== 'number' || !Number.isInteger(maxTurns) || maxTurns < 1) return null;
  const stopped = typeof record.stopped === 'string'
    ? GOAL_CONTINUATION_STOPS.find((reason) => reason === record.stopped)
    : undefined;
  return stopped ? { turn, maxTurns, stopped } : { turn, maxTurns };
}

/** A goal counts as "on" only while it is still being pursued. A completed or
 *  dropped goal keeps its record in the transcript but must not make the
 *  composer's toggle read as active — and `budget-limited` stays on, because
 *  that state is explicitly resumable.
 *
 *  The rule itself is `isGoalOpen` (shared with the composer, which gates the
 *  goal strip on the same question): two spellings of "is this goal still the
 *  chat's business" is exactly how the server and the UI come to disagree. */

/**
 * Extract the persisted mode selection from a session file's contents.
 *
 * Split from the file read so it is testable without a filesystem.
 */
export function readPersistedModes(body: string): PersistedModes {
  let plan: boolean | undefined;
  let goal: boolean | undefined;
  let goalLive = false;
  let goalRecord: GoalRecord | null = null;
  let goalContinuation: GoalContinuation | null = null;
  let goalMaxTurns: number | null = null;

  for (const record of parseJsonlLenient<Record<string, unknown>>(body)) {
    if (record?.type !== 'custom') continue;
    const data = record.data;
    if (!data || typeof data !== 'object') continue;
    const payload = data as Record<string, unknown>;

    // Both spellings: a session written before the rename carries the old
  // entry types, and refusing them would lose its plan on resume.
  if (record.customType === KABMO_PLAN_STATE_ENTRY || record.customType === CHAMBER_PLAN_STATE_ENTRY) {
      plan = payload.enabled === true;
      continue;
    }
    if (record.customType === KABMO_GOAL_STATE_ENTRY || record.customType === CHAMBER_GOAL_STATE_ENTRY) {
      const candidate = payload.goal;
      goalRecord = isGoalRecord(candidate) ? candidate : null;
      goalLive = payload.enabled === true && goalRecord?.status === 'active';
      goal = payload.enabled === true && goalRecord !== null && isGoalOpen(goalRecord.status);
      // Only an entry that CARRIES the key speaks about the loop: most of them
      // are goal transitions (`goal_updated`) with no verdict to report, and
      // treating their absence as "no verdict" would erase the last one on
      // every token update.
      if ('continuation' in payload) {
        goalContinuation = payload.continuation === null ? null : goalContinuationOf(payload.continuation);
      }
      // The ceiling is written on the same entries, but it OUTLIVES the
      // verdict (Resume clears the stop while the goal keeps its number), so
      // the last value that carried one wins rather than the last entry.
      const ceiling = payload.maxTurns;
      if (typeof ceiling === 'number' && Number.isInteger(ceiling) && ceiling > 0) goalMaxTurns = ceiling;
    }
  }

  if (plan === undefined && goal === undefined) return NONE;
  return { plan: plan === true, goal: goal === true, goalLive, goalRecord, goalContinuation, goalMaxTurns };
}

/** Read the persisted selection for a session file, or the empty selection when
 *  the file is missing or unreadable — a session with no history simply has no
 *  modes on. */
export async function loadPersistedModes(filePath: string): Promise<PersistedModes> {
  try {
    const file = Bun.file(filePath);
    if (!(await file.exists())) return NONE;
    return readPersistedModes(await file.text());
  } catch {
    return NONE;
  }
}
