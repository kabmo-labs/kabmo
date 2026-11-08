/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The ACP handshake: `initialize`, then `session/new` (or `session/load` when a
 * chat is being restored), then the selections the composer asked for.
 *
 * Split out of `AcpSession` because none of it needs the session's own state: it
 * needs the process, the four fields it seeds, and the picks — so it takes those
 * as arguments and writes them back on the target it is given.
 *
 * Two details are load-bearing and were each a bug:
 *
 *  - `session/load` REPLAYS the transcript as `session/update` frames, which the
 *    mapper has already turned into rows. The reply carries the (possibly
 *    unchanged) config list, and a load that answers no list still knows its
 *    session id — hence the `reloaded ?? { sessionId }` fallback.
 *  - the run's model is SEEDED from the selector the agent already reports.
 *    Nothing has been written yet at this point, so without the seed `runModel`
 *    stayed null until some later config write, and `get_state` then answered
 *    `provider: 'omp-acp'` (the harness id) with the whole `provider/model`
 *    string as the model id — which is what the generating indicator names.
 */

import { newSessionAfterActivation } from '@/server/lib/harness/acp/activation';
import { applySelections, configOption, modelFromOption } from '@/server/lib/harness/acp/prompt';
import { capabilitiesFrom } from '@/server/lib/harness/launch';
import type {
  AcpConfigOption,
  AcpInitializeResult,
  AcpSessionNewResult,
} from '@/server/lib/harness/acp/protocol';
import type { HarnessCapabilities } from '@/server/lib/harness/capabilities';
import type { HarnessId } from '@/shared/lib/harness/catalog';

/** The process slice a handshake drives; `AcpProcess` satisfies it as-is. */
export interface AcpHandshakeProcess {
  initialize(params: Record<string, unknown>, timeoutMs?: number): Promise<AcpInitializeResult>;
  loadSession(sessionId: string, cwd: string, timeoutMs?: number): Promise<unknown>;
  newSession(cwd: string, timeoutMs?: number): Promise<AcpSessionNewResult>;
}

/** The session fields a handshake seeds. */
export interface AcpHandshakeTarget {
  readonly cwd: string;
  readonly harness: HarnessId;
  sessionId: string;
  configOptions: AcpConfigOption[];
  runModel: { provider: string; modelId: string } | null;
  capabilities: HarnessCapabilities;
  setConfig(configId: string, value: string | boolean): Promise<unknown>;
}

/** The picks the composer sent for a brand-new session. */
export interface AcpHandshakeSelections {
  model: { provider: string; modelId: string } | null;
  thinking: string | null;
  mode: string | null;
}

export async function handshakeAcpSession(
  target: AcpHandshakeTarget,
  proc: AcpHandshakeProcess,
  wanted: AcpHandshakeSelections,
  sessionIdToLoad?: string,
): Promise<void> {
  const init = await proc.initialize({}, 60_000);
  /** opencode's plugin activation gate: the first `session/new`s refuse with
   *  `ServiceUnavailableError` until the agent's plugins finish booting. */
  const newSession = (cwd: string, timeoutMs?: number) =>
    newSessionAfterActivation(target.harness, cwd, (dir, ms) => proc.newSession(dir, ms), {
      ...(timeoutMs !== undefined ? { perAttemptMs: timeoutMs } : {}),
    });
  let session: AcpSessionNewResult;
  if (sessionIdToLoad) {
    await proc.loadSession(sessionIdToLoad, target.cwd, 120_000);
    const reloaded = await newSession(target.cwd).catch(() => null);
    session = reloaded ?? { sessionId: sessionIdToLoad };
  } else {
    session = await newSession(target.cwd, 120_000);
  }
  target.sessionId = session.sessionId || sessionIdToLoad || '';
  target.configOptions = session.configOptions ?? [];
  target.runModel = modelFromOption(configOption(target.configOptions, 'model'), target.harness);
  target.capabilities = capabilitiesFrom(init, target.configOptions, { usage: false, plan: false });
  await applySelections(target, wanted);
}
