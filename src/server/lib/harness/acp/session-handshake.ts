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
import { applyLaunchSelections, configOption, modelFromOption, modelsAsSelector } from '@/server/lib/harness/acp/prompt';
import { toAcpV2McpServers } from '@/server/lib/harness/acp/v2';
import type { SessionDirs } from '@/server/lib/harness/acp/verbs';
import { authMethodsOf, describeSignIn, headlessAuthMethod, isAuthRequiredError } from '@/server/lib/harness/acp/auth';
import { additionalDirectoriesFor, sessionRoots } from '@/server/lib/harness/acp/session-roots.server';
import { capabilitiesFrom } from '@/server/lib/harness/launch';
import type {
  AcpAgentCommand,
  AcpConfigOption,
  AcpInitializeResult,
  AcpMcpServer,
  AcpMcpServerWire,
  AcpProtocolVersion,
  AcpSessionModeState,
  AcpSessionModels,
  AcpSessionNewResult,
} from '@/server/lib/harness/acp/protocol';
import type { HarnessCapabilities } from '@/server/lib/harness/capabilities';
import type { AgentEvent } from '@/server/lib/omp/rpc/constants';
import type { HarnessId } from '@/shared/lib/harness/catalog';

/** The process slice a handshake drives; `AcpProcess` satisfies it as-is. */
export interface AcpHandshakeProcess {
  initialize(params?: Record<string, unknown>, timeoutMs?: number): Promise<AcpInitializeResult>;
  loadSession(
    sessionId: string,
    cwd: string,
    timeoutMs?: number,
    mcpServers?: AcpMcpServerWire[],
    dirs?: SessionDirs,
  ): Promise<unknown>;
  newSession(
    cwd: string,
    timeoutMs?: number,
    mcpServers?: AcpMcpServerWire[],
    dirs?: SessionDirs,
  ): Promise<AcpSessionNewResult>;
  /** The negotiated major; absent on a test double, which is a v1 double. */
  readonly protocolVersion?: AcpProtocolVersion;
  /** `session/resume`; absent on a process double used by older tests. */
  resumeSession?(
    sessionId: string,
    cwd: string,
    timeoutMs?: number,
    mcpServers?: AcpMcpServerWire[],
    replayFrom?: unknown,
    dirs?: SessionDirs,
  ): Promise<unknown>;
  /** `authenticate`; absent on a process double, which needs no login. */
  authenticate?(methodId: string, timeoutMs?: number): Promise<unknown>;
  /** `session/fork`; absent on a process double used by older tests. */
  forkSession?(
    sessionId: string,
    cwd: string,
    timeoutMs?: number,
    target?: Record<string, unknown>,
    meta?: Record<string, unknown>,
    mcpServers?: AcpMcpServerWire[],
    dirs?: SessionDirs,
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
  /** The `models` block the agent published, when it published one. */
  models?: AcpSessionModels | null;
  runModel: { provider: string; modelId: string } | null;
  capabilities: HarnessCapabilities;
  setConfig(configId: string, value: string | boolean): Promise<unknown>;
  /** `session/set_mode`; absent on a target that only speaks config options. */
  setMode?(modeId: string): Promise<unknown>;
  /** Whether prompts may carry image blocks; the agent advertised `image`. */
  acceptsImages?: boolean;
  /** Initial slash commands from a v2 setup response. */
  agentCommands?: AcpAgentCommand[];
  /** MCP servers every session request carries; empty when none are configured. */
  mcpServers?: AcpMcpServer[];
  /** Called as soon as `initialize` answers, before any session request, so a
   *  v2 resume snapshot can open a turn. */
  onProtocol?(version: AcpProtocolVersion): void;
  /** Push a notice when a restore had to start a fresh agent session; the
   *  operator must know the agent no longer holds the history. */
  emit?(event: AgentEvent): void;
  /** The environment the agent sees, read to decide whether an advertised
   *  `authMethods` entry can be satisfied headlessly. */
  authEnv?: Record<string, string | undefined>;
  /** The launch line, so a refused handshake can name the sign-in command. */
  readonly command?: string[];
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
  forkMeta?: Record<string, unknown>,
  /** Restore history as frames (`replayFrom` on a v2 peer, `session/load` on a
   *  v1 peer). Off for every ordinary resume: Kabmo's own transcript is on
   *  screen and a replay would duplicate it. */
  replay = false,
): Promise<void> {
  const init = await proc.initialize(undefined, 60_000);
  target.onProtocol?.(init.protocolVersion === 2 ? 2 : 1);
  // ACP's `initialize` lists the ways in; a client that never calls
  // `authenticate` makes every agent that requires a login refuse `session/new`
  // with `-32000`, which surfaces as a raw spawn failure. Only a HEADLESS method
  // is attempted — a terminal one wants a TTY Kabmo does not host.
  const methods = authMethodsOf(init);
  if (methods.length > 0 && proc.authenticate) {
    const methodId = headlessAuthMethod(methods, target.authEnv ?? {});
    if (methodId) await proc.authenticate(methodId, 120_000);
  }
  // stdio is the ACP baseline; `http`/`sse` are only real when the agent
  // advertises them. Sending an unadvertised transport is at best ignored and
  // at worst rejects the whole setup request, so the list is filtered here —
  // the same rule the navbar's list uses.
  const advertisedMcp = init.agentCapabilities?.mcpCapabilities;
  const requestedMcp = (target.mcpServers ?? []).filter((server) => {
    if (!('type' in server)) return true;
    return server.type === 'http' ? advertisedMcp?.http === true : advertisedMcp?.sse === true;
  });
  // A v2 peer validates `mcpServers` strictly (tagged entries, absolute stdio
  // command) and rejects the whole setup request otherwise. The conversion is
  // here because this is the first point the negotiated major is known.
  const mcpServers: AcpMcpServerWire[] = init.protocolVersion === 2
    ? toAcpV2McpServers(requestedMcp)
    : requestedMcp;
  // A chat whose cwd is a WORKTREE may work in the repository too, and the
  // agent only knows that if the setup request names it. Gated on the agent's
  // own capability, because `additionalDirectories` on a peer that does not
  // advertise it is at best ignored and at worst rejects the request.
  const dirs = additionalDirectoriesFor(
    await sessionRoots(target.cwd),
    target.cwd,
    init.agentCapabilities?.sessionCapabilities?.additionalDirectories !== undefined,
  );
  /** opencode's plugin activation gate: the first `session/new`s refuse with
   *  `ServiceUnavailableError` until the agent's plugins finish booting. */
  const newSession = (cwd: string, timeoutMs?: number) =>
    newSessionAfterActivation(target.harness, cwd, (dir, ms) => proc.newSession(dir, ms, mcpServers, dirs), {
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
      // claude-agent-acp's AIR extension: the fork point, when the caller has
      // one. An agent that does not read it ignores the key and forks whole.
      forkMeta,
      mcpServers,
      dirs,
    );
  } else if (sessionIdToLoad) {
    // ACP gates restoration on the AGENT's advertised capability: `loadSession`
    // replays history, `sessionCapabilities.resume` restores without replay, and
    // an agent that advertises neither must be refused in words. Calling
    // `session/load` anyway asked a non-supporting agent for a method it had not
    // advertised and surfaced its `-32601` as a spawn failure.
    const caps = init.agentCapabilities ?? {};
    const replayFrom = replay ? { type: 'start' as const } : undefined;
    const canResume = proc.protocolVersion === 2 || caps.sessionCapabilities?.resume != null;
    const canLoad = proc.protocolVersion !== 2 && caps.loadSession === true;
    if (!canResume && !canLoad) {
      throw new Error(
        `${target.harness} cannot restore this chat: it supports neither session/load nor session/resume`,
      );
    }
    // `session/resume` wins whenever the agent speaks it: it restores the SAME
    // session in place, while `session/load` replays and (on some adapters)
    // answers a forked id. Resuming instead of loading what the agent can resume
    // is what keeps the conversation's context, and the old order (load first)
    // handed every agent that advertises both an empty follow-up session.
    let restored: unknown;
    try {
      restored = canResume
        ? await (proc.resumeSession
            // v2 removed `session/load`; `session/resume` is baseline there.
            ? proc.resumeSession(sessionIdToLoad, target.cwd, 120_000, mcpServers, replayFrom, dirs)
            : Promise.reject(new Error(`${target.harness} cannot resume a session`)))
        : await proc.loadSession(sessionIdToLoad, target.cwd, 120_000, mcpServers, dirs);
    } catch (error) {
      // A restore that fails is not a reason to lose the chat: the agent may
      // have dropped the session, but Kabmo's own transcript is on screen. A
      // fresh session continues it, and the operator is told the history is not
      // in the agent's context — silently doing so is the failure this branch
      // exists to prevent. `fork` never reaches here, so nothing is substituted
      // under a fork's name.
      // A sign-in refusal is not a lost session: continuing in a fresh one would
      // hide the one action the operator must take. The sentence names the
      // agent's own command.
      if (isAuthRequiredError(error)) {
        const guidance = describeSignIn(authMethodsOf(init), (target.command ?? [target.harness]).join(' '));
        throw guidance ? new Error(`${error instanceof Error ? error.message : String(error)}. ${guidance}`) : error;
      }
      target.emit?.({
        type: 'notice',
        level: 'warning',
        message: `${target.harness} could not restore the previous session; continuing in a fresh session without in-agent history.`,
      });
      session = await newSession(target.cwd, 120_000);
      return finishHandshake(target, init, session, wanted);
    }
    const state = restored && typeof restored === 'object'
      ? (restored as Partial<AcpSessionNewResult>)
      : {};
    // A load may answer a DIFFERENT (forked) id: that id IS the restored
    // conversation, so it is the one to continue on. The registry re-points the
    // chat at it; falling back to a fresh `session/new` here would throw the
    // context away and leave the loaded session orphaned.
    const restoredId = typeof state.sessionId === 'string' && state.sessionId
      ? state.sessionId
      : sessionIdToLoad;
    session = { ...state, sessionId: restoredId };
  } else {
    session = await newSession(target.cwd, 120_000);
  }
  return finishHandshake(target, init, session, wanted);
}

/** Adopt the setup answer and apply the launch picks, for every branch. */
async function finishHandshake(
  target: AcpHandshakeTarget,
  init: AcpInitializeResult,
  session: AcpSessionNewResult,
  wanted: AcpHandshakeSelections,
): Promise<void> {
  target.sessionId = session.sessionId || target.sessionId || '';
  target.configOptions = session.configOptions ?? [];
  // An agent that publishes a `models` block instead of a `model` selector gets
  // a synthesized selector, so the picker, `get_state` and `set_model` read one
  // shape. A published selector always wins — it is what the agent will accept
  // back on `session/set_config_option`.
  const modelsSelector = configOption(target.configOptions, 'model')
    ? null
    : modelsAsSelector(session.models);
  if (modelsSelector) target.configOptions = [...target.configOptions, modelsSelector];
  target.models = session.models ?? null;
  target.modes = session.modes ?? null;
  target.acceptsImages = init.agentCapabilities?.promptCapabilities?.image === true;
  if (session.availableCommands) target.agentCommands = session.availableCommands;
  target.runModel = modelFromOption(configOption(target.configOptions, 'model'), target.harness);
  target.capabilities = capabilitiesFrom(init, target.configOptions, { usage: false, plan: false }, target.modes);
  await applyLaunchSelections(target, wanted);
}


