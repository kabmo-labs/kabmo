/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The persisted goal record for an ACP chat.
 *
 * A non-omp ACP agent has no `/kabmo-mode` extension and no transcript Kabmo
 * can read, so the composer's goal actions write this row and the driver reads
 * it after every turn. The shape is omp's `GoalRecord`, which lets the existing
 * strip, markers and reload logic work unchanged.
 */

import { getDb } from '@/server/db.server';
import type { GoalContinuation, GoalRecord } from '@/shared/lib/omp/mode/types';

/** The row, as the composer and the driver read it. */
export interface AcpGoalState {
  record: GoalRecord | null;
  continuation: GoalContinuation | null;
  /** Mirrored plan mode, for a session whose agent is no longer live. */
  plan: boolean;
  maxTurns: number | null;
  /** Automatic turns taken for the CURRENT goal. */
  turns: number;
}

const EMPTY: AcpGoalState = { record: null, continuation: null, plan: false, maxTurns: null, turns: 0 };

/**
 * Sessions this process has SEEN with a goal row. It gates the turn-end driver
 * so an ordinary ACP turn does not open the database at all — the common case —
 * and a test that never created a goal never touches the developer's real DB.
 * A restart repopulates it when the chat's modes are read on open.
 */
function goalSessions(): Set<string> {
  const global = globalThis as unknown as { __kabmoAcpGoalSessions?: Set<string> };
  global.__kabmoAcpGoalSessions ??= new Set();
  return global.__kabmoAcpGoalSessions;
}

export function noteAcpGoalSession(sessionId: string): void {
  goalSessions().add(sessionId);
}

export function hasAcpGoalSession(sessionId: string): boolean {
  return goalSessions().has(sessionId);
}

/** The default ceiling the extension uses when none is stored. */
export const DEFAULT_GOAL_MAX_TURNS = 25;

function parseRecord(raw: unknown): GoalRecord | null {
  if (typeof raw !== 'string' || !raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    if (typeof record.id !== 'string' || typeof record.objective !== 'string') return null;
    return record as unknown as GoalRecord;
  } catch {
    return null;
  }
}

function parseContinuation(raw: unknown): GoalContinuation | null {
  if (typeof raw !== 'string' || !raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const entry = value as Record<string, unknown>;
    if (!Number.isInteger(entry.turn) || !Number.isInteger(entry.maxTurns)) return null;
    return entry as unknown as GoalContinuation;
  } catch {
    return null;
  }
}

export async function loadAcpGoalState(sessionId: string): Promise<AcpGoalState> {
  try {
    const db = await getDb();
    const row = await db.get(
      'SELECT record, continuation, plan, max_turns, turns FROM harness_goal_state WHERE session_id = ?',
      [sessionId],
    );
    if (!row) return { ...EMPTY };
    const record = parseRecord(row.record);
    if (record) noteAcpGoalSession(sessionId);
    return {
      record,
      continuation: parseContinuation(row.continuation),
      plan: row.plan === 1,
      maxTurns: typeof row.max_turns === 'number' ? row.max_turns : null,
      turns: typeof row.turns === 'number' ? row.turns : 0,
    };
  } catch {
    return { ...EMPTY };
  }
}

export async function saveAcpGoalState(sessionId: string, state: AcpGoalState): Promise<void> {
  if (state.record) noteAcpGoalSession(sessionId);
  try {
    const db = await getDb();
    await db.run(
      `INSERT INTO harness_goal_state
         (session_id, record, continuation, plan, max_turns, turns, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(session_id) DO UPDATE SET
         record = excluded.record,
         continuation = excluded.continuation,
         plan = excluded.plan,
         max_turns = excluded.max_turns,
         turns = excluded.turns,
         updated_at = excluded.updated_at`,
      [
        sessionId,
        state.record ? JSON.stringify(state.record) : null,
        state.continuation ? JSON.stringify(state.continuation) : null,
        state.plan ? 1 : 0,
        state.maxTurns,
        state.turns,
        Date.now(),
      ],
    );
  } catch {
    // Mode state is best-effort here; the live process still answers.
  }
}

/** Persist only the mirrored plan flag (a live selector remains authoritative). */
export async function saveAcpPlanState(sessionId: string, plan: boolean): Promise<void> {
  const state = await loadAcpGoalState(sessionId);
  await saveAcpGoalState(sessionId, { ...state, plan });
}
