/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Ask one live omp child to re-read its skill/command/plugin roots.
 *
 * Deliberately NOT routed through `dispatchSessionCommand`: that path owns the
 * turn state machine (`promptRunning`, the stream row, queue delivery) because
 * a prompt it dispatches is a USER TURN. `/reload-plugins` is not a turn —
 * omp answers `agentInvoked: false`, writes nothing to the transcript (verified
 * on 18.4.3: a session file is byte-identical across a reload), and answers it
 * from its command loop even while a turn streams. Measured: ack in 16-40 ms
 * during a live turn AND while a blocking approval dialog was parked, with the
 * turn completing normally afterwards and the new skill listed immediately.
 * Going through the prompt path would flip a busy session to "starting a run"
 * — the one state a reload must not disturb.
 *
 * Returns false when the child is gone; a missing ack is still a success (an
 * older omp accepts the command without echoing `agentInvoked`).
 */

import type { RpcProcess } from '@/server/lib/omp/rpc/process';
import type { IdleReaper } from '@/server/lib/omp/rpc/idle-reaper';
import { RELOAD_PLUGINS_TIMEOUT_MS } from '@/server/lib/omp/rpc/constants';

/** Child state a reload touches. Not a turn, but still work: keep the reaper off. */
export interface ReloadPluginsHost {
  isAlive(): boolean;
  readonly idle: IdleReaper;
  readonly proc: RpcProcess;
}

export async function reloadChildPlugins(host: ReloadPluginsHost): Promise<boolean> {
  if (!host.isAlive()) return false;
  host.idle.reset();
  const ack = await host.proc.sendCommand<{ agentInvoked?: boolean } | undefined>(
    { type: 'prompt', message: '/reload-plugins' },
    RELOAD_PLUGINS_TIMEOUT_MS,
  );
  return ack?.agentInvoked !== true;
}
