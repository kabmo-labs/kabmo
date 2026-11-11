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
import { applyLaunchSelections, configOption, modelFromOption } from '@/server/lib/harness/acp/prompt';
import { capabilitiesFrom } from '@/server/lib/harness/launch';
import type {
  AcpAgentCommand,
  AcpConfigOption,
  AcpInitializeResult,
  AcpProtocolVersion,
  AcpSessionModeState,
  AcpSessionNewResult,
} from '@/server/lib/harness/acp/protocol';
import type { HarnessCapabilities } from '@/server/lib/harness/capabilities';
import type { HarnessId } from '@/shared/lib/harness/catalog';

/** The process slice a handshake drives; `AcpProcess` satisfies it as-is. */
export interface AcpHandshakeProcess {
  initialize(params?: Record<string, unknown>, timeoutMs?: number): Promise<AcpInitializeResult>;
  loadSession(sessionId: string, cwd: string, timeoutMs?: number): Promise<unknown>;
  newSession(cwd: string, timeoutMs?: number): Promise<AcpSessionNewResult>;
  /** The negotiated major; absent on a test double, which is a v1 double. */
  readonly protocolVersion?: AcpProtocolVersion;
  /** `session/resume`; absent on a process double used by older tests. */
  resumeSession?(sessionId: string, cwd: string, timeoutMs?: number): Promise<unknown>;
  /** `session/fork`; absent on a process double used by older tests. */
  forkSession?(
    sessionId: string,
    cwd: string,
    timeoutMs?: number,
    target?: Record<string, unknown>,
  ): Promise<AcpSessionNewResult>;
}

/** The session fields a handshake seeds. */
export interface AcpHandshakeTarget {
  readonly cwd: string;
  readonly harness: HarnessId;
  sessionId: string;
  configOptions: AcpConfigOption[];
  /** The older Session Modes API, when the agent publishes no `mode` selector. */
  modes?: AcpSessionModeState | null;
  runModel: { provider: string; modelId: string } | null;
  capabilities: HarnessCapabilities;
  setConfig(configId: string, value: string | boolean): Promise<unknown>;
  /** `session/set_mode`; absent on a target that only speaks config options. */
  setMode?(modeId: string): Promise<unknown>;
  /** Whether prompts may carry image blocks; the agent advertised `image`. */
  acceptsImages?: boolean;
  /** Initial slash commands from a v2 setup response. */
  agentCommands?: AcpAgentCommand[];
  /** Called as soon as `initialize` answers, before any session request, so a
   *  v2 resume snapshot can open a turn. */
  onProtocol?(version: AcpProtocolVersion): void;
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
  forkFromSessionId?: string,
): Promise<void> {
  const init = await proc.initialize(undefined, 60_000);
  target.onProtocol?.(init.protocolVersion === 2 ? 2 : 1);
  /** opencode's plugin activation gate: the first `session/new`s refuse with
   *  `ServiceUnavailableError` until the agent's plugins finish booting. */
  const newSession = (cwd: string, timeoutMs?: number) =>
    newSessionAfterActivation(target.harness, cwd, (dir, ms) => proc.newSession(dir, ms), {
      ...(timeoutMs !== undefined ? { perAttemptMs: timeoutMs } : {}),
    });
  let session: AcpSessionNewResult;
  if (forkFromSessionId) {
    // A fork is a NEW agent session that inherits the source's context; the
    // returned id is the child's own. Refusing here is deliberate: silently
    // falling back to `session/new` would start an empty chat under a fork's
    // name, which is the substitution this feature exists to prevent.
    if (!proc.forkSession) {
      throw new Error(`${target.harness} cannot fork a session`);
    }
    session = await proc.forkSession(
      forkFromSessionId,
      target.cwd,
      120_000,
      // zcode's fork is checkpoint-scoped; its schema defaults `target` but
      // the ACP call needs it stated or the runtime answers "sessionId is
      // required" for a request it cannot place. Other harnesses reject an
      // unknown `target`, so it is sent only where it is understood.
      target.harness === 'zcode' ? { kind: 'latestCheckpoint' } : undefined,
    );
  } else if (sessionIdToLoad) {
    // ACP gates restoration on the AGENT's advertised capability: `loadSession`
    // replays history, `sessionCapabilities.resume` restores without replay, and
    // an agent that advertises neither must be refused in words. Calling
    // `session/load` anyway asked a non-supporting agent for a method it had not
    // advertised and surfaced its `-32601` as a spawn failure.
    const caps = init.agentCapabilities ?? {};
    const restored = proc.protocolVersion === 2
      // v2 removed `session/load`; `session/resume` is baseline and replays
      // nothing unless `replayFrom` asks, which is exactly what Kabmo wants —
      // its own transcript is already on screen.
      ? await (proc.resumeSession
          ? proc.resumeSession(sessionIdToLoad, target.cwd, 120_000)
          : Promise.reject(new Error(`${target.harness} cannot resume a session`)))
      : caps.loadSession === true
        ? await loadReplacement(proc, newSession, sessionIdToLoad, target.cwd)
        : caps.sessionCapabilities?.resume != null
          ? await (proc.resumeSession
              ? proc.resumeSession(sessionIdToLoad, target.cwd, 120_000)
              : Promise.reject(new Error(`${target.harness} cannot resume a session`)))
          : null;
    if (restored === null) {
      throw new Error(
        `${target.harness} cannot restore this chat: it supports neither session/load nor session/resume`,
      );
    }
    const state = restored && typeof restored === 'object'
      ? (restored as Partial<AcpSessionNewResult>)
      : {};
    // `session/resume` replays NOTHING and creates nothing: the id stays the
    // caller's, and only the config/mode state the reply carries is adopted.
    session = { ...state, sessionId: sessionIdToLoad };
  } else {
    session = await newSession(target.cwd, 120_000);
  }
  target.sessionId = session.sessionId || sessionIdToLoad || '';
  target.configOptions = session.configOptions ?? [];
  target.modes = session.modes ?? null;
  target.acceptsImages = init.agentCapabilities?.promptCapabilities?.image === true;
  if (session.availableCommands) target.agentCommands = session.availableCommands;
  target.runModel = modelFromOption(configOption(target.configOptions, 'model'), target.harness);
  target.capabilities = capabilitiesFrom(init, target.configOptions, { usage: false, plan: false }, target.modes);
  await applyLaunchSelections(target, wanted);
}

/**
 * The v1 load path: replay the agent's history into the mapper, then continue on
 * a fresh agent session.
 *
 * Deliberate: measured on omp, a load answers a FORKED id, and continuing on it
 * would write a second sidebar row for one chat.
 */
async function loadReplacement(
  proc: AcpHandshakeProcess,
  create: (cwd: string, timeoutMs?: number) => Promise<AcpSessionNewResult>,
  sessionId: string,
  cwd: string,
): Promise<unknown> {
  await proc.loadSession(sessionId, cwd, 120_000);
  return (await create(cwd).catch(() => null)) ?? { sessionId };
}
