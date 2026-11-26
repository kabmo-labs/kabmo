/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The sidebar's VOLATILE half: live stream status, the model serving the run,
 * and whether the session is blocked on a dialog.
 *
 * Split from the STRUCTURE (`sidebar-data.server.ts`) because the two have
 * wildly different costs and cadences: the structure runs a full omp JSONL
 * discovery scan, while this is a single SQLite read plus the live process
 * registry. The realtime transport publishes them as separate topics so a
 * stream-status flip does not re-scan every session file.
 */

import { loadStreamStates } from '@kabmo-labs/kabmo-session-stream-state';
import { healStaleStreamStatuses } from '@kabmo-labs/kabmo-session-stream-state/stream-heal.server';
import { awaitingInputSessionIds, liveRunSessionIds, reconcileLiveSessions } from '@kabmo-labs/kabmo-live-sessions';
import type { SidebarStatusEntry } from '@kabmo-labs/kabmo-app-contracts/realtime';

/**
 * The sidebar's VOLATILE fields, keyed by session id: live stream status, the
 * model serving the run, and whether the session is blocked on a dialog.
 *
 * `repair` runs the two self-heal halves, because this is where a stale spinner
 * is actually looked at:
 *
 *   - a `stream` row whose owning Kabmo process is gone (judged from the row
 *     alone, so every instance agrees);
 *   - a `stream` row THIS process owns with no live run behind it — an orphan,
 *     which only this process can see (see `healStaleStreamStatuses`), plus a
 *     `get_state` reconcile for the rows this process owns.
 *
 * The realtime publisher passes `repair: false`: it runs on every stream-status
 * WRITE, and a write is already the truth for the run it describes. The repair
 * belongs to the subscribe-time snapshot, which is the moment the old sidebar
 * poll used to provide it.
 */
/** One session's volatile sidebar fields, as the status topic carries them. */
export async function loadSidebarStatus(
  options: { repair?: boolean } = {},
): Promise<Record<string, SidebarStatusEntry>> {
  // No MOCK short-circuit: the simulated stream writes the same `stream` row a
  // real run does (`routes/chat/stream.ts`), so the sidebar spinner and the
  // chat's generating indicator have one source in every mode. Returning `{}`
  // here is what kept the two from ever agreeing under `MOCK=true`.
  if (options.repair !== false) {
    // The database is shared by every Kabmo instance on the machine, so a
    // `stream` row may belong to a process this one cannot see. Ownership is
    // read from the row itself (its `owner_pid`) against OS liveness — never
    // against this process's own runtime registry, which would make two
    // instances report different statuses for the same run.
    //
    // The live-run set is passed for the OTHER half only: the rows this process
    // owns. It is deliberately not the staleness rule, which must stay
    // instance-independent.
    await healStaleStreamStatuses(liveRunSessionIds());
    // The heal judges a row from its owner pid alone; a row this process owns
    // while no run is behind it needs the OWNER's view of the child, which only
    // a `get_state` can give (see `run-settle.server.ts`). Fire-and-forget: the
    // list never waits on a probe, and the next read carries the settled status.
    reconcileLiveSessions();
  }

  const status: Record<string, SidebarStatusEntry> = {};
  for (const [id, state] of Object.entries(await loadStreamStates())) {
    status[id] = {
      streamStatus: state.status,
      ...(state.model ? { runModel: state.model } : {}),
      ...(state.failure ? { runFailure: state.failure } : {}),
      ...(state.startedAt !== undefined ? { runStartedAt: state.startedAt } : {}),
    };
  }
  // Sessions blocked on a dialog nobody has answered yet. Read live from the
  // process registry (never persisted): the child that owns the question is the
  // same thing that owns the flag, so a restart cannot leave a stale badge.
  for (const id of awaitingInputSessionIds()) {
    status[id] = { ...(status[id] ?? {}), awaitingInput: true };
  }
  return status;
}
