/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Server-authoritative per-session stream status, persisted in SQLite so the
 * sidebar can render spinner/check. Statuses:
 *
 *   stream  — a run is in flight (prompt dispatch → agent_end)
 *   finish  — the run ended normally (agent_end), not yet seen
 *   abort   — the user stopped it, not yet seen
 *
 * A terminal status is a one-shot badge: opening the session acknowledges it
 * (`markStreamSeen` deletes the row), which is exactly the "check appears
 * once, disappears when the session is opened" contract.
 *
 * A row also carries the MODEL serving that run (`model_provider` + `model_id`),
 * written by the dispatcher that owns the `stream` row and updated only when the
 * writer actually knows the model — so the generating indicator names the real
 * provider/model, in every tab and every Kabmo instance, with no per-session
 * JSONL read.
 *
 * `stream` rows record the pid of Kabmo process running that session, so
 * a `stream` row whose owner is gone self-heals to `finish` — see
 * `healStaleStreamStatuses`. Ownership travels in the row because the database
 * is SHARED by every Kabmo instance on the machine (~/.kabmo/db.sqlite)
 * while the runtime session registry is per process: without the column, a
 * second instance opening its sidebar judged the first instance's live run by
 * its own empty registry and cleared a spinner that was still working.
 *
 * Every write raises the realtime `stream-status` signal, which is what the
 * socket's `sidebar:status` topic publishes from. All writes are
 * fire-and-forget: a status write must never fail a prompt.
 */

import { getDb } from '@/server/db.server';
import { emitRealtimeSignal } from '@/server/lib/realtime/signals.server';

export type SessionStreamStatus = 'stream' | 'finish' | 'abort';

/** The model a session's run is served by, as the generating indicator names it. */
export interface SessionRunModel {
  provider: string;
  modelId: string;
}

/** A session's stream row: its status plus the model that serves that run. */
export interface SessionStreamState {
  status: SessionStreamStatus;
  model?: SessionRunModel;
}

/**
 * Upsert a session's stream row.
 *
 * `model` is written only when the caller actually knows it (prompt dispatch,
 * where the wrapper has reconciled `get_state`/`set_model`); every other write —
 * `agent_start`, a terminal badge, the heal pass — passes nothing and the
 * COALESCE keeps the stored pair, so a status flip cannot blank the model the
 * indicator is reading from the same row.
 */
export async function markStreamStatus(
  sessionId: string,
  status: SessionStreamStatus,
  model?: SessionRunModel | null,
): Promise<void> {
  try {
    const db = await getDb();
    // The owner describes the process running a live row; a terminal badge
    // belongs to no process, and leaving a pid on it would invite a later read
    // to judge the badge by the liveness of a process it never concerned.
    const ownerPid = status === 'stream' ? process.pid : null;
    await db.run(
      `INSERT INTO session_stream_state (session_id, status, owner_pid, model_provider, model_id, updated_at)
       VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(session_id) DO UPDATE SET
         status = excluded.status,
         owner_pid = excluded.owner_pid,
         model_provider = COALESCE(excluded.model_provider, session_stream_state.model_provider),
         model_id = COALESCE(excluded.model_id, session_stream_state.model_id),
         updated_at = excluded.updated_at`,
      [sessionId, status, ownerPid, model?.provider ?? null, model?.modelId ?? null],
    );
    // The signal bus has no imports of its own, so this edge cannot close a
    // cycle: the realtime layer subscribes to it, and this module only raises.
    emitRealtimeSignal('stream-status');
  } catch {
    // Status tracking is best-effort by design.
  }
}

/**
 * Rename the model a LIVE stream row carries, leaving its status and owner
 * alone.
 *
 * omp's `model_changed` frame carries no payload, so the wrapper re-reads
 * `get_state` and lands here: a retry under a fallback chain
 * (`retry.fallbackChains`) switches the model MID-RUN, and the row the sidebar
 * and the generating indicator name the run by would otherwise keep the
 * pre-fallback model for the rest of the turn.
 *
 * Live-only, deliberately: `markStreamStatus(id, 'stream', model)` upserts a
 * `stream` row, which would RESURRECT a spinner for a run that already ended
 * (a fallback landing on the run's last frame). This can only ever rename a row
 * that still means "a run is in flight".
 */
export async function markStreamModel(sessionId: string, model: SessionRunModel): Promise<void> {
  try {
    const db = await getDb();
    await db.run(
      `UPDATE session_stream_state
         SET model_provider = ?, model_id = ?, updated_at = CURRENT_TIMESTAMP
       WHERE session_id = ? AND status = 'stream'`,
      [model.provider, model.modelId, sessionId],
    );
    // The row the sidebar names a run by just changed, so subscribers must see it.
    emitRealtimeSignal('stream-status');
  } catch {
    // Status tracking is best-effort by design.
  }
}

/**
 * Drop an optimistic `stream` row whose prompt never started a turn: the ack
 * reported `agentInvoked: false`, or the dispatch failed before omp accepted
 * it. Live-only — a `stream` row a concurrent `agent_start` wrote is still the
 * truth, and terminal badges are cleared by `markStreamSeen`.
 */
export async function clearStreamStatus(sessionId: string): Promise<void> {
  try {
    const db = await getDb();
    await db.run("DELETE FROM session_stream_state WHERE session_id = ? AND status = 'stream'", [sessionId]);
    emitRealtimeSignal('stream-status');
  } catch {
    // Best-effort.
  }
}

/**
 * Opening the session clears its terminal badge (one-shot contract).
 *
 * Terminal-only: a `stream` row is a LIVE run and must never be deleted here.
 * Deleting one used to be possible when a client acked from a stale status
 * map (a `finish` row the sidebar last saw before `agent_start` overwrote it
 * with `stream`) — the spinner vanished while the run kept going. The client
 * `markSeen` path also guards terminal-only, but the server is the source of
 * truth and must hold the line on its own.
 */
export async function markStreamSeen(sessionId: string): Promise<boolean> {
  try {
    const db = await getDb();
    const result = await db.run("DELETE FROM session_stream_state WHERE session_id = ? AND status != 'stream'", [sessionId]);
    const deleted = (result.changes ?? 0) > 0;
    // Only a real deletion changes what a sidebar renders; signalling an
    // already-cleared badge would republish the same map for every open.
    if (deleted) {
      emitRealtimeSignal('stream-status');
    }
    return deleted;
  } catch {
    // Best-effort.
    return false;
  }
}

/** Every stream row keyed by session id — the sidebar loader's single read. */
export async function loadStreamStates(): Promise<Record<string, SessionStreamState>> {
  try {
    const db = await getDb();
    const rows = (await db.all('SELECT session_id, status, model_provider, model_id FROM session_stream_state')) as {
      session_id: string;
      status: string;
      model_provider: string | null;
      model_id: string | null;
    }[];
    const map: Record<string, SessionStreamState> = {};
    for (const row of rows) {
      if (row.status !== 'stream' && row.status !== 'finish' && row.status !== 'abort') continue;
      map[row.session_id] = {
        status: row.status,
        ...(row.model_provider && row.model_id
          ? { model: { provider: row.model_provider, modelId: row.model_id } }
          : {}),
      };
    }
    return map;
  } catch {
    return {};
  }
}

/** Statuses only — for callers (the frame fold's end check) that read no model. */
export async function loadStreamStatuses(): Promise<Record<string, SessionStreamStatus>> {
  const states = await loadStreamStates();
  const map: Record<string, SessionStreamStatus> = {};
  for (const [id, state] of Object.entries(states)) map[id] = state.status;
  return map;
}
