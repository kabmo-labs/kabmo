/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Ask one live omp child to re-read its MCP configuration.
 *
 * `/mcp reload` is a text-mode builtin: measured on 18.20.0 over RPC, it
 * answers `agentInvoked: false` in a few milliseconds, emits one
 * `command_output` frame, and opens no turn — the same contract
 * `/reload-plugins` has. It re-runs `discoverAndConnect`, so a per-session
 * agent dir whose `mcp.json` was just rewritten is picked up without a respawn.
 *
 * Deliberately NOT routed through `dispatchSessionCommand`: that path owns the
 * turn state machine, and a reload must not flip a busy session to "starting a
 * run".
 */

import type { RpcProcess } from '@/server/lib/omp/rpc/process';
import type { IdleReaper } from '@/server/lib/omp/rpc/idle-reaper';
import { RELOAD_PLUGINS_TIMEOUT_MS } from '@/server/lib/omp/rpc/constants';

/** Child state a reload touches. Not a turn, but still work: keep the reaper off. */
export interface ReloadMcpHost {
  isAlive(): boolean;
  readonly idle: IdleReaper;
  readonly proc: RpcProcess;
}

export async function reloadChildMcp(host: ReloadMcpHost): Promise<boolean> {
  if (!host.isAlive()) return false;
  host.idle.reset();
  const ack = await host.proc.sendCommand<{ agentInvoked?: boolean } | undefined>(
    { type: 'prompt', message: '/mcp reload' },
    RELOAD_PLUGINS_TIMEOUT_MS,
  );
  return ack?.agentInvoked !== true;
}
