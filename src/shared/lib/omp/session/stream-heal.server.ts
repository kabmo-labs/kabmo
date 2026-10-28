/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The sidebar's stream-status self-heal: which `stream` rows describe a run
 * that is not going to finish, and how they are released.
 *
 * Split from `stream-state.server.ts` (which owns the row's writes and reads)
 * because this is a different concern with a different failure mode: the writes
 * record what happened, and these rules decide when a record has been ABANDONED
 * — getting them wrong is user-visible in both directions, clearing the spinner
 * of a run that is still working or leaving one turning forever.
 *
 * Both halves end at `finish`, which is the honest outcome: the run is not
 * going to finish.
 */

import { getDb } from '@/server/db.server';
import { getProcessState, isProcessAlive, type ProcessState } from '@/server/lib/lifecycle/identity';

/**
 * Whether a `stream` row has no live run behind it and must heal to `finish`.
 *
 * The owner pid is the only input, so EVERY Kabmo instance reaches the same
 * verdict from the same row — which is the point. Judging a row by the reader's
 * own runtime registry instead made instances disagree about one run: a second
 * instance opening its sidebar saw an empty registry, called the first
 * instance's working run stale, and cleared a spinner that was still turning.
 *
 * LIVENESS ALONE IS NOT ENOUGH, because a pid is recycled. An owner that has
 * exited leaves its pid to be handed to an unrelated process, and a row written
 * by that dead instance then reads as live forever: the run is gone, nothing
 * will ever write its terminal status, and no other instance can heal it. That
 * is the exact trap `lifecycle/identity` documents for the CLI's port registry
 * — identity comes from the OS command line, never from `kill(pid, 0)`.
 *
 * So the question is "is this still the process that wrote the row?": `matched`
 * (a Kabmo command line) is live, `unknown` (a host whose probe cannot
 * answer) keeps the previous bias and is treated as live, and a `mismatched`
 * pid is a stranger whose row is stale.
 *
 * The identity probe (a command line through libproc/`/proc`) is paid only for
 * a pid that is alive, which is the rare case.
 *
 * A row with no owner predates the column and heals: new code always records a
 * pid for `stream`, so an ownerless `stream` row can only come from an older
 * process, whose run nothing can vouch for.
 */
export function isStaleStreamRow(
  row: { session_id: string; owner_pid: number | null },
  isOwnerAlive: (ownerPid: number) => boolean = isProcessAlive,
  processState: (ownerPid: number) => ProcessState = getProcessState,
): boolean {
  if (row.owner_pid === null) return true;
  if (!isOwnerAlive(row.owner_pid)) return true;
  return processState(row.owner_pid) === 'mismatched';
}

/**
 * Whether a `prompt_result` frame proves the dispatched prompt opened no turn,
 * so the live `stream` row written at dispatch must be released.
 *
 * The PROMPT ACK does not carry `agentInvoked`; this frame does, and it arrives
 * after it. Two senders reach it, and the dispatch can only catch the first:
 *
 *   - a builtin (`/usage`, `/compact`) answers the ack itself with
 *     `agentInvoked:false`, and the dispatcher clears the row there;
 *   - Kabmo's OWN extension (`/kabmo-mode plan on` — the composer's
 *     Plan/Goal toggles) acks a bare `{success:true}` and reports
 *     `agentInvoked:false` on THIS frame instead. Verified against the real
 *     child: the dispatcher read that bare ack as a run, armed the
 *     awaiting-agent-start deadline, and left the row `stream` forever.
 *
 * `agentInvoked === false` is required rather than `!== true`: a frame that
 * omits the field (an older omp, or omp's own trailing `prompt_result` for a
 * real run, which carries `true`) must never be read as "no turn".
 *
 * `streaming` is the same guard the dispatcher's own release uses, and it is
 * load-bearing: a `/kabmo-mode` sent while a turn runs is answered in ~20 ms
 * from omp's command loop with the turn still streaming, so without it this
 * would delete THAT turn's live row and blank a spinner that is working.
 *
 * The row is owned by a LIVE process either way, so `healStaleStreamStatuses`
 * can never reach it — this frame is the only thing that can release it.
 */
export function releasesStreamRowOnPromptResult(
  event: Record<string, unknown>,
  host: { streaming: boolean; sessionId: string },
): boolean {
  return event.agentInvoked === false && !host.streaming && Boolean(host.sessionId);
}

/**
 * Whether a `stream` row is an ORPHAN: owned by the reading process, which
 * holds no live run for it.
 *
 * This is the half of the heal that only the owning process can answer. The
 * row's owner is ALIVE (so {@link isStaleStreamRow} can never reach it) and no
 * other instance can see this process's runtime registry — without this rule
 * the row is unreleasable and the spinner turns until the process restarts.
 * Measured: a dropped prompt leaves exactly this shape.
 *
 * `liveRunIds` OMITTED means "release nothing", deliberately: a caller that
 * cannot answer "what am I running?" must never guess, and an EMPTY set is the
 * claim "I run nothing", which would release every row this process owns.
 */
export function isOrphanStreamRow(
  row: { session_id: string; owner_pid: number | null },
  readerPid: number,
  liveRunIds: Set<string> | undefined,
): boolean {
  if (liveRunIds === undefined) return false;
  return row.owner_pid === readerPid && !liveRunIds.has(row.session_id);
}

/**
 * Self-heal, in two directions. Both leave the row at `finish`, which is the
 * honest outcome: the run is not going to finish.
 *
 *  1. A `stream` row whose OWNER IS GONE — a Kabmo process that exited
 *     mid-run (crash, restart, SIGKILL), or whose pid was recycled by a
 *     stranger. Nothing will ever write the terminal status for it. This half
 *     is judged from the row alone (`owner_pid` against OS liveness AND
 *     identity), so every instance reading the shared database reaches the same
 *     verdict, and it takes no caller context.
 *
 *  2. A `stream` row THIS PROCESS OWNS while holding no live run for it — the
 *     orphan. The owner is alive, so half (1) can never reach it, and no other
 *     instance can see it either: only the owning process knows whether it
 *     still has a run for the session. This is the shape a dropped prompt
 *     leaves behind (omp accepts the prompt and opens no turn, so no
 *     `agent_end` ever arrives — measured with Kabmo's own
 *     `/kabmo-mode` extension, whose bare `{success:true}` ack read as a
 *     run), and without this half the spinner turns until the process restarts.
 *
 * `liveRunIds` is what the caller knows and this module cannot: the sessions
 * its process is running right now (`getLiveRunSessionIds`). OMITTED means
 * "release nothing" — deliberately the default, so a caller that cannot answer
 * the question never guesses. Half (2) is skipped entirely rather than assumed
 * empty, because an empty set is the claim "this process runs nothing", which
 * would release every row the process owns.
 *
 * Runs on the sidebar loader's path, so the authoritative status travels with
 * the same fetch that refreshes the list.
 */
export async function healStaleStreamStatuses(liveRunIds?: Set<string>): Promise<void> {
  try {
    const db = await getDb();
    const rows = (await db.all("SELECT session_id, owner_pid FROM session_stream_state WHERE status = 'stream'")) as {
      session_id: string;
      owner_pid: number | null;
    }[];
    const released = new Set<string>();
    for (const row of rows) {
      if (isStaleStreamRow(row) || isOrphanStreamRow(row, process.pid, liveRunIds)) {
        released.add(row.session_id);
      }
    }
    if (released.size === 0) return;
    // `status = 'stream'` is re-checked in the WHERE clause: a run that started
    // between the read above and this write owns its row now, and healing it
    // would clear the spinner of a session that is demonstrably working.
    const ids = [...released];
    const placeholders = ids.map(() => '?').join(', ');
    await db.run(
      `UPDATE session_stream_state SET status = 'finish', updated_at = CURRENT_TIMESTAMP
       WHERE status = 'stream' AND session_id IN (${placeholders})`,
      ids,
    );
  } catch {
    // Best-effort.
  }
}
