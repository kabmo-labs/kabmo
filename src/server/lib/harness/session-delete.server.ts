/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Remove a chat from the AGENT's own history.
 *
 * Purging Kabmo's rows is not enough for a session that ran on a harness Kabmo
 * does not own: `opencode`, `dsh` and `antigravity` keep the conversation in
 * their own store, and an import (`session/list`) copies it straight back on the
 * next run. The reported defect — deleting an imported row and watching it
 * return — is this omission, not the purge.
 *
 * Three routes, in the order they are tried:
 *
 *  1. **The local store, when Kabmo can name it.** `dsh` stores
 *     `<DSH_HOME|~/.dsh>/sessions/<project>/<id>/` and does NOT implement
 *     `session/delete` (measured 0.2.2-rc.1: its ACP surface advertises only
 *     `list`), so asking it is a spawn that can only answer "no". The directory
 *     is removed directly.
 *  2. **ACP `session/delete`, when the agent advertises
 *     `sessionCapabilities.delete`.** One process is spawned per harness and
 *     reused for every id in the batch; a spawn per row would pay a full agent
 *     boot 300 times for one user action.
 *  3. **`omp-rpc`/`omp-acp` keep nothing Kabmo cannot reach**: omp's JSONL is
 *     the transcript the purge already removes, so there is no second copy.
 *
 * A failure is a verdict, never silence: the caller refuses the delete and shows
 * the reason, because a row that reappears on the next import is the bug this
 * module exists to prevent.
 */

import fs from 'node:fs';
import { AcpProcess } from '@kabmo-labs/kabmo-acp-client/client';
import { withGatewayCompatibility } from '@kabmo-labs/kabmo-acp-client/gateway-env';
import { loadHarnessConfig } from '@/server/lib/harness/config.server';
import { resolveAccountLaunch } from '@/server/lib/harness/accounts.server';
import { customHarness, ensureCustomHarnesses } from '@/server/lib/harness/custom.server';
import { isSinglePathSegment } from '@/server/lib/fs/path-segment';
import { dshStoreDirs } from '@/server/lib/harness/session-transcript.server';
import type { HarnessLaunch } from '@/server/lib/harness/launch-table';
import type { HarnessSessionRecord } from '@/server/lib/harness/session-store.server';
import type { AcpInitializeResult } from '@kabmo-labs/kabmo-acp-protocol/protocol';
import { harnessDescriptor, type HarnessId } from '@kabmo-labs/kabmo-harness-catalog';

export interface AgentSessionRemoval {
  /** True when the agent's own copy is gone (or the agent keeps none here). */
  removed: boolean;
  /** Why not, when `removed` is false. Shown verbatim in the delete dialog. */
  error?: string;
}

/** The launch line and the local-store lookup, injectable so a test can name a
 *  fake agent and a temp store without touching real harness config. */
export interface AgentSessionRemoverDeps {
  launch?: (harness: HarnessId) => Promise<HarnessLaunch>;
  storeDirs?: (harness: HarnessId, agentSessionId: string) => Promise<string[]>;
}

/** One batch's worth of agent-side deletions: one child per harness, disposed
 *  once at the end. */
export interface AgentSessionRemover {
  remove(record: HarnessSessionRecord): Promise<AgentSessionRemoval>;
  dispose(): Promise<void>;
}

/** `sessionCapabilities.delete` is advertised by PRESENCE, and `null` is the
 *  spec's other way of saying absent — same rule as `capabilitiesFrom`. */
function advertisesDelete(init: AcpInitializeResult): boolean {
  const sessionCaps = init.agentCapabilities?.sessionCapabilities;
  const value = sessionCaps?.delete;
  return value !== undefined && value !== null;
}

/** The local-store lookup every deletion uses. A harness with no entry keeps no
 *  store Kabmo can address, so it falls through to the ACP verb. */
async function localStoreDirs(harness: HarnessId, agentSessionId: string): Promise<string[]> {
  if (harness === 'dsh') return dshStoreDirs(agentSessionId);
  return [];
}

async function defaultLaunch(harness: HarnessId): Promise<HarnessLaunch> {
  await ensureCustomHarnesses();
  return resolveAccountLaunch(harness, await loadHarnessConfig(harness));
}

interface Connection {
  proc: AcpProcess;
  deleteSession: boolean;
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * One remover for a request (or a whole batch). The launch line is resolved per
 * harness, once; a failed handshake is evicted so a later id can retry instead
 * of inheriting the first failure.
 */
export function createAgentSessionRemover(deps: AgentSessionRemoverDeps = {}): AgentSessionRemover {
  const resolve = deps.launch ?? defaultLaunch;
  const lookupStore = deps.storeDirs ?? localStoreDirs;
  const connections = new Map<string, Promise<Connection>>();

  async function connect(harness: HarnessId): Promise<Connection> {
    const launch = await resolve(harness);
    const env = withGatewayCompatibility(harness, launch.env);
    const proc = new AcpProcess({
      command: launch.command,
      cwd: process.cwd(),
      onNotification: () => {},
      onStderr: () => {},
      ...(env ? { env } : {}),
      ...(launch.stripEnv ? { envDrop: launch.stripEnv } : {}),
    });
    try {
      const init = await proc.initialize(undefined, 60_000);
      return { proc, deleteSession: advertisesDelete(init) };
    } catch (cause) {
      await proc.dispose(1_000).catch(() => {});
      throw cause;
    }
  }

  function connectionFor(harness: HarnessId): Promise<Connection> {
    const existing = connections.get(harness);
    if (existing) return existing;
    const started = connect(harness);
    connections.set(harness, started);
    // A rejected handshake must not be cached: the next id deserves its own try.
    void started.catch(() => connections.delete(harness));
    return started;
  }

  async function remove(record: HarnessSessionRecord): Promise<AgentSessionRemoval> {
    const harness = record.harness as HarnessId;
    const agentSessionId = record.agentSessionId || record.sessionId;
    if (!isSinglePathSegment(agentSessionId)) {
      return { removed: false, error: 'Invalid session id' };
    }
    // omp's session IS the JSONL the purge removes; there is no second store.
    if (harness === 'omp-rpc' || harness === 'omp-acp') return { removed: true };
    // The registry loads asynchronously; without this a user-added harness looks
    // like a removed one and its agent is never asked.
    await ensureCustomHarnesses();
    // A custom harness the user removed: no agent exists to ask, and no row to
    // bring the chat back. The purge is the whole deletion.
    if (!harnessDescriptor(harness) && !customHarness(harness)) return { removed: true };

    const dirs = await lookupStore(harness, agentSessionId);
    if (dirs.length > 0) {
      try {
        for (const dir of dirs) await fs.promises.rm(dir, { recursive: true, force: true });
        return { removed: true };
      } catch (cause) {
        return { removed: false, error: messageOf(cause) };
      }
    }

    let connection: Connection;
    try {
      connection = await connectionFor(harness);
    } catch (cause) {
      return { removed: false, error: messageOf(cause) };
    }
    if (!connection.deleteSession) {
      return {
        removed: false,
        error: `${harness} keeps its sessions and does not let Kabmo delete them`,
      };
    }
    try {
      await connection.proc.deleteSession(agentSessionId, 30_000);
      return { removed: true };
    } catch (cause) {
      return { removed: false, error: messageOf(cause) };
    }
  }

  async function dispose(): Promise<void> {
    const pending = [...connections.values()];
    connections.clear();
    await Promise.all(
      pending.map(async (started) => {
        try {
          await (await started).proc.dispose(1_000);
        } catch {
          // A child that never handshook was already disposed by `connect`.
        }
      }),
    );
    // `dispose` is synchronous on the client; give the kill a turn to land so a
    // batch's last delete does not race the caller's next spawn.
    await Bun.sleep(0);
  }

  return { remove, dispose };
}
