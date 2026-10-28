/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Parsing Kabmo mode extension's notice markers.
 *
 * The extension reports every outcome through `ctx.ui.notify` with a prefixed
 * JSON payload (`CHAMBER_PLAN_STATE:{…}`), because that is the only channel
 * that reaches Kabmo from inside the child without inventing a frame
 * type. Everything else about the transport is already handled: the notice
 * arrives on the same stream the transcript uses, and the fold decides whether
 * it becomes a marker or a visible notice row.
 *
 * An unrecognised or malformed marker is NOT a marker — it falls through to a
 * normal notice, so a version skew shows the user a readable line instead of
 * swallowing the message.
 */

import {
  ALL_MODE_MARKERS,
  GOAL_CONTINUATION_STOPS,
  type GoalContinuation,
  type GoalRecord,
} from '@/shared/lib/omp/mode/types';

/**
 * Every marker the extension emits, in BOTH spellings, longest-first so a
 * prefix of another marker can never win the match.
 *
 * The pre-rename spelling is here because a resumed session's transcript holds
 * the markers that were emitted when it was written — a `CHAMBER_PLAN_STATE:`
 * row from last week is still a marker, and treating it as prose would print a
 * JSON blob into the timeline.
 */
const MARKERS = ALL_MODE_MARKERS;

export type ModeMarker = string;

/** @deprecated Use `ModeMarker`. Kept as the exported name existing callers import. */
export type ChamberMarker = ModeMarker;

export interface ParsedMarker {
  marker: ModeMarker;
  payload: Record<string, unknown>;
}

/** Parse a notice message into a marker, or null when it is an ordinary
 *  notice (or a marker whose payload does not parse). */
export function parseModeMarker(message: string): ParsedMarker | null {
  for (const marker of MARKERS) {
    if (!message.startsWith(marker)) continue;
    const raw = message.slice(marker.length).trim();
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return { marker, payload: parsed as Record<string, unknown> };
      }
    } catch {
      // A truncated payload is not a marker; render it as a notice.
    }
    return null;
  }
  return null;
}

/** The goal record a `CHAMBER_GOAL_STATE` payload carries, when it carries one. */
export function goalRecordFromMarker(payload: Record<string, unknown>): GoalRecord | null {
  const goal = payload.goal;
  if (!goal || typeof goal !== 'object' || Array.isArray(goal)) return null;
  const record = goal as Record<string, unknown>;
  if (typeof record.id !== 'string' || typeof record.objective !== 'string') return null;
  return record as unknown as GoalRecord;
}

/** Whether a `CHAMBER_GOAL_STATE` payload reports the mode as on. */
export function goalEnabledFromMarker(payload: Record<string, unknown>): boolean {
  return payload.enabled === true;
}

/**
 * The continuation record a `CHAMBER_GOAL_CONTINUATION` payload carries — or a
 * nested `continuation` value of a goal-state payload — or null when the value
 * is not one.
 *
 * Both numbers are required and the turn must be 1-based: the child increments
 * before it emits, so a payload naming turn 0 is a version skew, and a row that
 * said "turn NaN of undefined" would be worse than no row at all.
 */
export function continuationFromMarker(value: unknown): GoalContinuation | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const payload = value as Record<string, unknown>;
  const turn = Number(payload.turn);
  const maxTurns = Number(payload.maxTurns);
  if (!Number.isInteger(turn) || turn < 1) return null;
  if (!Number.isInteger(maxTurns) || maxTurns < 1) return null;
  const stopped = typeof payload.stopped === 'string'
    ? GOAL_CONTINUATION_STOPS.find((reason) => reason === payload.stopped)
    : undefined;
  return stopped ? { turn, maxTurns, stopped } : { turn, maxTurns };
}

/** @deprecated Use `parseModeMarker`. */
export const parseChamberMarker = parseModeMarker;
