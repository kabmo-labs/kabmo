/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Refresh the plugin/skill inventory of every LIVE omp process Kabmo
 * drives: the per-session children AND the pooled utility processes.
 *
 * omp discovers skills, commands and plugins once per process and does not
 * watch the filesystem, so a SKILL.md written while a session runs is invisible
 * to that session until it restarts. `/reload-plugins` is the only refresh omp
 * exposes, and it is reachable as a prompt because the builtin has a text-mode
 * `handle`. Verified on 18.4.3: it answers `agentInvoked: false` (no model
 * turn), leaves the session file byte-identical, and emits
 * `available_commands_update`.
 *
 * EVERY live process is refreshed, including a BUSY one. That is the correction
 * this module now carries: the previous version skipped `session.isBusy()`
 * sessions on the theory that a prompt dispatched into a running turn is a
 * queue insert. Measured on 18.4.3, it is not — a `/reload-plugins` sent
 * mid-turn is answered from omp's command loop in 16-40 ms with the turn still
 * streaming, the turn then completes normally, and the new skill is listed
 * immediately. (A PLAIN mid-turn prompt is dropped outright rather than
 * queued: the same run showed one `agent_start` for two prompts, so the "queue
 * insert" this guard feared is not what omp does with either kind.)
 *
 * The guard was actively harmful, because the common case IS a busy session:
 * the `create-skill` skill writes its SKILL.md with a tool WHILE the chat that
 * invoked it is streaming, so the write landed during a run and the refresh was
 * skipped — leaving the new skill invisible until the user found the manual `⟳`
 * button. Verified against a live Kabmo: a skill created mid-turn was absent
 * from `get_available_commands` after the turn ended, and appeared the moment a
 * session reloaded.
 *
 * A parked ask/approval dialog is no obstacle either (measured: `get_state`,
 * `get_available_commands` and `/reload-plugins` all answered within 16 ms with
 * a blocking `select` pending, because omp services the RPC command loop
 * independently of the turn waiting on the dialog).
 *
 * The two sources are injected so the policy is testable without patching
 * modules — see `reload.server.test.ts`. Best-effort throughout: one child
 * failing never blocks the others.
 */

import { listRpcSessions } from '@/server/lib/omp/rpc/session-registry';
import { reloadUtilityProcesses } from '@/server/lib/omp/rpc/utility';

/** The part of a live session a reload needs. */
export interface ReloadableSession {
  sessionId: string;
  /** Re-read this child's skill/command roots. Returns false when it is gone. */
  reloadPlugins: () => Promise<boolean>;
}

export interface ReloadDeps {
  /** Every live session child. Read on each pass. */
  sessions: () => ReloadableSession[];
  /** Refresh the pooled utility processes that answer the composer's popup. */
  reloadUtility: () => Promise<void>;
}

export interface Reloader {
  /** Ask every live omp process to re-discover plugins. Returns the session ids
   *  whose reload was accepted. */
  reload: () => Promise<string[]>;
}

export function createReloader(deps: ReloadDeps): Reloader {
  /** In-flight pass, so a burst of triggers coalesces onto one broadcast
   *  instead of racing a second pass through the same children. */
  let inFlight: Promise<string[]> | null = null;

  async function broadcast(): Promise<string[]> {
    const reloaded: string[] = [];
    await Promise.all([
      ...deps.sessions().map(async (session) => {
        try {
          if (await session.reloadPlugins()) reloaded.push(session.sessionId);
        } catch (error) {
          console.error(
            `Failed to reload plugins for session ${session.sessionId}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }),
      // The utility pool answers the composer's `/` popup and the settings
      // panes, so a stale pool keeps offering the pre-change command list even
      // after every session has refreshed. It reports its own per-cwd failures.
      deps.reloadUtility(),
    ]);
    return reloaded;
  }

  function reload(): Promise<string[]> {
    if (inFlight) return inFlight;
    inFlight = broadcast().finally(() => {
      inFlight = null;
    });
    return inFlight;
  }

  return { reload };
}

const serverReloader = createReloader({
  sessions: () => listRpcSessions(),
  reloadUtility: reloadUtilityProcesses,
});

/** Ask every live omp process to re-discover plugins. Returns the session ids
 *  whose reload was accepted. */
export function reloadLiveSessions(): Promise<string[]> {
  return serverReloader.reload();
}
