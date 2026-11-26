/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * A brand-new omp session: adopt the prewarmed child, or cold-spawn one.
 *
 * Split out of `session-registry.ts` (which owns the live map and the spawn
 * path) because this is the ONE place a prewarmed process is consumed, and it
 * carries a rule the cold path does not: a spawn-time system prompt or skill
 * filter makes a warm child UNUSABLE. omp reads both flags only at spawn, so
 * adopting one would silently drop a stage's instructions — the same class of
 * bug as adopting a child with the wrong approval mode.
 */

import type { ApprovalMode } from '@kabmo-labs/kabmo-omp-access-mode';
import { DEFAULT_APPROVAL_MODE } from '@kabmo-labs/kabmo-omp-access-mode';
import type { AgentSessionWrapper } from '@/server/lib/omp/rpc/manager';
import type { SessionPromptArgs } from '@/server/lib/omp/rpc/constants';
import { claimPrewarmedSession } from '@/server/lib/omp/rpc/prewarm-pool';
import { ompSessionRegistry, startRpcSession } from '@/server/lib/omp/rpc/session-registry';
import { registerSpawnedSession } from '@/server/lib/omp/rpc/session-registration';
import { syncDiscoveryRootsWatch } from '@/server/lib/omp/config/roots-watch.server';
import { emitRealtimeSignal } from '@kabmo-labs/kabmo-realtime-signals';
import { mintAgentEnvironment, rememberAgentToken } from '@/server/lib/sessions/agent-token.server';

/** Consume the prewarmed process for `cwd` when its approval mode matches, or
 *  spawn a fresh session. The returned wrapper is already registered under its
 *  real session id, mirroring startRpcSession's bookkeeping. */
export async function startNewRpcSession(
  cwd: string,
  approvalMode?: ApprovalMode,
  modeEnv?: Record<string, string>,
  promptArgs?: SessionPromptArgs,
): Promise<{ session: AgentSessionWrapper; realSessionId: string }> {
  const mode = approvalMode ?? DEFAULT_APPROVAL_MODE;
  // Mint here, not at the route: the prewarmed entry and the cold spawn both
  // get a callback credential, and no caller can forget it.
  const { token, env: agentEnv } = mintAgentEnvironment();
  const env = { ...(modeEnv ?? {}), ...agentEnv };
  // A prewarmed child was spawned with no `--append-system-prompt` and no
  // `--skills`, and omp reads both ONLY at spawn. Adopting it would silently
  // drop the stage's instructions, so a caller that names either gets a cold
  // spawn — the same reason a differing mode selection kills the warm entry.
  const needsColdSpawn = Boolean(promptArgs?.systemPrompt) || Boolean(promptArgs?.skills?.length);
  const wrapper = needsColdSpawn ? undefined : await claimPrewarmedSession(cwd, mode, env);

  if (!wrapper) {
    const started = await startRpcSession(
      `__new__${Bun.randomUUIDv7()}`, '', cwd, undefined, mode, env, undefined, promptArgs,
    );
    await rememberAgentToken(started.realSessionId, token).catch((cause: unknown) => {
      console.error(`[sessions] could not record the agent token for ${started.realSessionId}:`, cause);
    });
    return started;
  }

  // A claimed prewarmed process recorded its own token before entering the
  // pool; recording this call's token would invalidate the child's environment.

  const registry = ompSessionRegistry();
  const realSessionId = wrapper.sessionId;
  // The same registration the cold path uses: it installs the destroy cleanup
  // AND starts the change journal, so a prewarmed session is not a second
  // convention.
  registerSpawnedSession(registry, wrapper, realSessionId, realSessionId);
  // A prewarmed process is adopted here, not in `startRpcSession`, so this is
  // the only spawn path that sees it — a session's cwd may sit outside every
  // registered workspace, and the discovery watcher has to learn it. Awaited
  // for the same reason as in `startRpcSession`: the attach is asynchronous,
  // and the caller's first write must not land before the watch exists.
  await syncDiscoveryRootsWatch();
  // Same as `startRpcSession`: a topic subscribed against the pre-spawn id (or
  // a placeholder) needs a fresh snapshot now that a child is reachable.
  emitRealtimeSignal('session-attached', realSessionId);
  return { session: wrapper, realSessionId };
}
