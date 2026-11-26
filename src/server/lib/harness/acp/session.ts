/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * One live ACP session: the bridge between `AcpProcess` + `AcpFrameMapper` and
 * the `HarnessSession` contract every route speaks. It owns STATE only — the
 * id, selectors, model, run flags and approval queue. Every RULE lives beside
 * it, one module per concern (`session-handshake`, `session-intake`, `turn`,
 * `session-stop`, `session-lifecycle`, `session-inbound`, `session-web-state`).
 *
 * `send()` takes the SAME command vocabulary the routes send omp, so
 * `routes/agent/command.ts` needs no second dispatch table.
 */

import { AcpProcess } from '@/server/lib/harness/acp/client';
import { openSessionProcess } from '@/server/lib/harness/acp/session-process';
import { AcpTurns, type AcpTurnEndInfo } from '@/server/lib/harness/acp/turn';
import { acpBackgroundProbe, acpTurns, acpWiringFor } from '@/server/lib/harness/acp/session-wiring';
import { AcpFrameMapper } from '@/server/lib/harness/acp/frames';
import { AcpReplay } from '@/server/lib/harness/acp/replay';
import { startAcpSession } from '@/server/lib/harness/acp/session-start';
import type { AcpHandshakeSelections } from '@/server/lib/harness/acp/session-handshake';
import type {
  AcpConfigOption,
  AcpId,
  AcpProtocolVersion,
  AcpSessionModeState,
  AcpSessionModels,
} from '@/server/lib/harness/acp/protocol';
import { promptContent, startAcpPrompt } from '@/server/lib/harness/acp/session-intake';
import { cancelAcpTurn, dropAcpSession, endAcpSessionTurn } from '@/server/lib/harness/acp/session-stop';
import { setAcpConfig, setAcpMode, type AcpConfigWriter } from '@/server/lib/harness/acp/session-config';
import { acpConfigView, type AcpConfigProcess } from '@/server/lib/harness/acp/session-config-view';
import * as verbs from '@/server/lib/harness/acp/verbs';
import { acpPendingDialogs, answerAcpDialog } from '@/server/lib/harness/acp/session-approvals';
import { beginAcpTurn } from '@/server/lib/harness/acp/session-turns';
import { capabilitiesFrom } from '@/server/lib/harness/launch';
import { PendingPermissions } from '@/server/lib/harness/acp/permissions';
import { handleAcpNotification } from '@/server/lib/harness/acp/session-notify';
import { RawNotificationSink, type RawNotificationListener } from '@/server/lib/harness/acp/raw-listeners';
import { AcpUsageMeter, type AcpContextUsage } from '@/server/lib/harness/acp/session-usage';
import { handleAcpClientRequest, type AcpClientRequestAnswer } from '@/server/lib/harness/acp/session-requests';
import { reportAcpExit, type AcpExitInfo } from '@/server/lib/harness/acp/session-exit';
import { acpExited, closeAcpSession, destroyAcp } from '@/server/lib/harness/acp/session-lifecycle';
import { SessionListeners } from '@/server/lib/harness/acp/session-listeners';
import type { AcpBackgroundProbe } from '@/server/lib/harness/acp/background-probe';
import { acpWebState } from '@/server/lib/harness/acp/session-web-state';
import { acpIdleReaper } from '@/server/lib/harness/acp/session-idle';
import { AcpSubagents, type AcpSubagentRecord } from '@/server/lib/harness/acp/subagents';
import { AcpInbound } from '@/server/lib/harness/acp/session-inbound';
import { DEFAULT_APPROVAL_MODE, isApprovalMode, type ApprovalMode } from '@kabmo-labs/kabmo-omp-access-mode';
import { dispatchCommand, type AcpCommandHost } from '@/server/lib/harness/acp/commands';
import { markStreamStatus } from '@/shared/lib/omp/session/stream-state.server';
import type { AcpSessionOptions } from '@/server/lib/harness/acp/session-options';
import type { AcpMcpServer } from '@/server/lib/harness/acp/protocol';
import type { HarnessCapabilities } from '@/server/lib/harness/capabilities';
import type { HarnessSession } from '@/server/lib/harness/session';
import type { HarnessId } from '@kabmo-labs/kabmo-harness-catalog';
import type { AgentEvent } from '@/server/lib/omp/rpc/constants';
import type { IdleReaper } from '@/server/lib/omp/rpc/idle-reaper';

/** The process verbs the config view calls, bound to the CURRENT session id. */
function configProcess(proc: AcpProcess): AcpConfigProcess {
  return {
    setConfigOption: (session, id, value) => proc.setConfigOption(session, id, value),
    setMode: (session, modeId) => proc.setMode(session, modeId),
    setModel: (session, modelId) => verbs.setModel(proc.call, session, modelId),
  };
}

export class AcpSession implements HarnessSession, AcpCommandHost {
  readonly harness: HarnessId;
  readonly cwd: string;
  readonly sessionFile = '';
  /** The launch line, so a refused handshake can name the sign-in command. */
  readonly command: string[];
  /** The environment the agent sees, read to satisfy a headless auth method. */
  readonly authEnv?: Record<string, string | undefined>;
  sessionId = '';
  /** The turn in flight — the only one whose frames are accepted. Public so the
   *  notification router can note activity on it. */
  readonly turns: AcpTurns;
  runModel: { provider: string; modelId: string } | null = null;
  /** The agent's own slash-command list; the composer's `/` pool reads it. */
  agentCommands: { name: string; description?: string; inputHint?: string }[] = [];
  /** The agent's plan entries, published for the Todos panel. */
  planEntries: unknown[] = [];
  /** Messages this session has moved: prompts sent plus assistant messages the
   *  mapper closed. omp reports the same quantity from its transcript. */
  messageCount = 0;
  /** Prompts this session dispatched — the telemetry panel's user count. */
  promptCount = 0;
  /** Assistant messages the mapper closed, for the same panel. */
  assistantCount = 0;
  /** The last `usage_update` the agent reported, or null when it never did. */
  readonly usage = new AcpUsageMeter();
  get contextUsage(): AcpContextUsage | null { return this.usage.contextUsage; }
  get totalCost(): number { return this.usage.totalCost; }
  get usageTokens(): number { return this.usage.usageTokens; }
  /** The composer's approval tier. Answered in-process by {@link onClientRequest}. */
  accessMode: ApprovalMode = DEFAULT_APPROVAL_MODE;
  capabilities: HarnessCapabilities = capabilitiesFrom({ protocolVersion: 1 }, [], { usage: false, plan: false });
  configOptions: AcpConfigOption[] = [];
  /** The older Session Modes API, adopted when the agent publishes one. */
  modes: AcpSessionModeState | null = null;
  /** The `models` block the agent published, when it published one instead of
   *  a `model` selector (measured on grok). */
  models: AcpSessionModels | null = null;
  /** Whether the agent advertised `promptCapabilities.image`. */
  acceptsImages = false;
  /** Set only when the agent explicitly refused embedded context. */
  acceptsEmbeddedContext: boolean | undefined = undefined;
  /** MCP servers every session request carries; empty when none are configured. */
  readonly mcpServers: AcpMcpServer[];
  private readonly proc: AcpProcess;
  /** The quiet-window reclaim; the rules live in `session-idle.ts`. */
  readonly idle: IdleReaper;
  /** Watches for work that finishes after `end_turn`; see `background-work.ts`. */
  readonly background: AcpBackgroundProbe;
  private readonly mapper = new AcpFrameMapper();
  private readonly events = new SessionListeners();
  /** Raw `session/update` sinks: the frame log the raw panel reads. Public so
   *  `session-notify.ts` can feed it before the mapper folds a frame. */
  readonly rawSink = new RawNotificationSink();
  readonly permissions = new PendingPermissions();
  /** Child sessions this parent announced (the subagents RFD). */
  readonly subagents = new AcpSubagents();
  /** Admission, addressing and child cards — see `session-inbound.ts`.
   *  Lazy: a test mounts this class on its prototype, where a field initializer
   *  never runs, and `onNotification` must still work there. */
  private inboundState: AcpInbound | null = null;
  private get inbound(): AcpInbound {
    return this.inboundState ??= new AcpInbound({
      subagents: this.subagents,
      emit: (event) => this.emit(event),
      replaying: () => this.replay.isActive,
    });
  }
  private destroyHook: (() => void) | null = null;
  destroyed = false;
  /** True only for a restore: replay frames are accepted and collected. */
  private readonly wantsReplay: boolean;
  readonly replay = new AcpReplay();
  /** Set when Kabmo ends the process, so a requested stop is not reported as a failure. */
  closing = false;

  constructor(options: AcpSessionOptions, cwd: string) {
    this.harness = options.harness;
    this.cwd = cwd;
    this.command = options.command;
    if (options.env) this.authEnv = options.env;
    this.proc = openSessionProcess(options, cwd, {
      onNotification: (method, params) => this.onNotification(method, params),
      onClientRequest: (id, method, params) => this.onClientRequest(id, method, params),
      onExit: (info) => this.onExit(info),
    });
    this.idle = acpIdleReaper(this, options.idleDestroyMs);
    // `sessionId`/`runModel` start empty and are read LIVE: the handshake sets
    // them, and a closed message must carry the model it actually ran on.
    const wiring = acpWiringFor(this, { proc: this.proc, mapper: this.mapper, idle: this.idle });
    this.background = acpBackgroundProbe(wiring);
    this.turns = acpTurns(wiring);
    this.mcpServers = options.mcpServers ?? [];
    this.wantsReplay = options.replay === true;
    this.requested = { model: options.model ?? null, thinking: options.thinkingLevel ?? null, mode: options.mode ?? null };
    this.accessMode = isApprovalMode(options.accessMode) ? options.accessMode : DEFAULT_APPROVAL_MODE;
    this.config = acpConfigView(this, configProcess(this.proc));
  }

  /** The selector view the config rules write through. */
  private readonly config: AcpConfigWriter;
  /** The picks the spawn carried, applied after setup. */
  private readonly requested: AcpHandshakeSelections;
  /** `initialize` + `session/new|load|resume`, then the requested selections. */
  async start(sessionIdToLoad?: string, forkFromSessionId?: string, forkMeta?: Record<string, unknown>): Promise<{ sessionId: string }> {
    // Frames that arrive BEFORE the setup answer is applied cannot be routed:
    // the session id they belong to is not known yet. They are held, not
    // dropped, and replayed in arrival order once it is.
    return this.inbound.run(
      () => startAcpSession(this, this.proc, this.mapper, this.replay, this.wantsReplay, this.requested, sessionIdToLoad, forkFromSessionId, forkMeta),
      (method, params) => handleAcpNotification(this, method, params),
    );
  }

  get protocol(): AcpProtocolVersion { return this.proc.protocolVersion === 2 ? 2 : 1; }
  /** The OS pid of the agent child, for the Stats panel's lease. */
  get pid(): number | undefined { return this.proc.pid; }
  get process(): AcpProcess { return this.proc; }
  /** Set by the handshake as soon as `initialize` answers. */
  onProtocol(version: AcpProtocolVersion): void { this.turns.completion = version === 2 ? 'state' : 'response'; }
  isAlive(): boolean { return !this.destroyed && this.proc.isAlive; }
  get isStreaming(): boolean { return this.turns.isStreaming; }
  get isPromptRunning(): boolean { return this.turns.isPromptRunning; }
  isRunning(): boolean { return this.isAlive() && (this.turns.isPromptRunning || this.turns.isStreaming); }
  /** A child outlives its turn: reclaiming the parent under it kills work. */
  isBusy(): boolean { return this.isRunning() || this.permissions.size() > 0 || this.subagents.anyRunning(); }
  onEvent(listener: (event: AgentEvent) => void): () => void { return this.events.add(listener); }
  /** Raw `session/update` payloads, before the mapper folds them. */
  onRawNotification(listener: RawNotificationListener): () => void { return this.rawSink.add(listener); }
  emit(event: AgentEvent): void { this.replay.push(event); this.events.emit(event); }
  /** Run the single destroy callback the registry installed. */
  runDestroyHook(): void { this.destroyHook?.(); }

  /** Teardown seams: methods, not fields, because a test mounts this class on
   *  its prototype and a field initializer never runs there. */
  disposeProcess(): Promise<void> { return this.proc.dispose(); }
  closeAgentSession(): Promise<void> { return closeAcpSession(this); }
  reportExit(info: AcpExitInfo): Promise<void> { return reportAcpExit(this, info); }

  /** The dispatcher's command surface — see `commands.ts`. A command is also
   *  the clearest sign the session is still wanted. */
  send(command: Record<string, unknown>): Promise<unknown> {
    this.idle.reset();
    return dispatchCommand(this, command);
  }

  getPendingUiDialogs(): Record<string, unknown>[] { return acpPendingDialogs(this.permissions); }

  resolvePendingUiDialog(id: string): void {
    // A dialog the client dismissed is a REFUSAL, not a no-answer.
    this.resolvePermission(id, false);
  }

  onDestroy(callback: () => void): void {
    this.destroyHook = callback;
  }

  /** Dispatcher seam: one steering send. */
  steer(blocks: unknown[], queue: 'steering' | 'followUp'): Promise<unknown> {
    return this.proc.steer(this.sessionId, blocks, queue);
  }

  /** The blocks one prompt sends (text, images, `@path` links). */
  blocksFor(message: string, images: unknown): Promise<unknown[]> { return promptContent(this, message, images); }

  /** Hold an input the agent has no mid-turn channel for. */
  queueTurnInput(message: string, images: unknown): void {
    this.turns.queue(message, images);
  }

  /** Record a mid-turn user message; the mapper drops live user frames. */
  recordUserTurn(message: string, images: unknown): void { this.emit({ type: 'user_turn', message, images }); }

  /** The durable run marker a reattaching tab reads; a field so a test stubs it. */
  markStream: (status: 'stream' | 'finish' | 'abort', failure?: string | null) => void = (status, failure) => {
    if (!this.sessionId) return;
    void markStreamStatus(this.sessionId, status, status === 'stream' ? this.runModel : undefined, failure).catch(() => {});
  };

  /** Turn-end bookkeeping the panels read — see `session-stop.ts`. */
  onTurnEnded(info: AcpTurnEndInfo): Promise<void> { return endAcpSessionTurn(this, info); }

  /** Drop this session so the next command respawns it — see `session-stop.ts`. */
  dropLostSession(): void { dropAcpSession(this); }

  /** Dispatcher seam: stop the turn and settle what it parked. */
  cancelTurn(): void {
    cancelAcpTurn(this);
  }

  /** Adopt the composer's access pick. ACP answers approvals in-process, so no
   *  respawn is needed — unlike omp's spawn-time flag. */
  setAccessMode(mode: ApprovalMode): void {
    this.accessMode = mode;
  }

  /** Dispatcher seam: the selector writes this session accepts. */
  async setConfig(configId: string, value: string | boolean): Promise<unknown> {
    return setAcpConfig(this.config, configId, value);
  }

  /** `session/set_mode`: the pre-config-options way to move a mode. */
  async setMode(modeId: string): Promise<unknown> {
    return setAcpMode(this.config, modeId);
  }

  /** Answer a pending approval — every exit answers the agent, or it hangs. */
  resolvePermission(dialogId: string, confirmed: boolean, optionId?: string): unknown {
    answerAcpDialog(this.permissions, this.proc, dialogId, confirmed, optionId, this.sessionId);
    return null;
  }

  webState(): Record<string, unknown> {
    return { ...acpWebState(this), protocolVersion: this.protocol, subagents: this.subagents.list() };
  }

  /** Run one turn — see `session-intake.ts` for the refusal and the ACK. */
  startTurn(message: string, images: unknown, options?: { quiet?: boolean }): unknown {
    return startAcpPrompt(this, message, images, options);
  }

  /** The seam `startAcpPrompt` opens a turn through. */
  beginTurn(message: string, images: unknown): unknown {
    return beginAcpTurn(this, this.turns, message, images);
  }

  /** One agent notification, routed — see `session-notify.ts`.
   *
   *  Held while the handshake is open: the address gate needs the session id,
   *  and a setup-time frame dropped there is output the user never sees. */
  private onNotification(method: string, params: Record<string, unknown>): void {
    this.inbound.admit(method, params, (nextMethod, nextParams) => handleAcpNotification(this, nextMethod, nextParams));
  }

  absorbUsage(update: Record<string, unknown>): void { this.usage.absorb(update); }
  resetUsageTokens(): void { this.usage.reset(); }
  acceptingFrames(): boolean { return this.replay.isActive || this.turns.acceptingFrames(); }
  mapUpdate(update: Record<string, unknown>): AgentEvent[] { return this.mapper.mapUpdate(update); }
  onStateUpdate(update: Record<string, unknown>): void { this.turns.onStateUpdate(update); this.replay.markIdle(update.state); }
  respond(id: AcpId, result: unknown): void { this.proc.respond(id, result); }
  /** Emit the card frames for one child record. */
  subagentFrame(record: AcpSubagentRecord): void {
    this.inbound.emitSubagent(record);
  }
  /** v2's explicit end-of-replay marker. */
  onReplayComplete(): void { this.replay.markSettled(); }
  /** Close every child card when the parent goes away. */
  finishSubagents(): void {
    this.inbound.closeSubagents();
  }
  /** Agent→client requests: every branch answers or refuses. */
  private onClientRequest(id: AcpId, method: string, params: Record<string, unknown>): Promise<AcpClientRequestAnswer> {
    this.idle.reset();
    return handleAcpClientRequest(this, id, method, params);
  }

  /** The agent's process is gone — see `session-lifecycle.ts`. */
  private onExit(info: AcpExitInfo): Promise<void> {
    return acpExited(this, info);
  }

  destroy(): void { void this.destroyAndWait(); }

  /** Remove this chat from the agent's own history, when it offers the method.
   *
   *  `false` (no `session/delete`, or no agent id yet) makes the caller fall back
   *  to the local store; a failure is THROWN so the delete route can refuse
   *  instead of leaving a row that returns on the next import. */
  async deleteAgentSession(): Promise<boolean> {
    if (!this.sessionId || !this.capabilities.deleteSession) return false;
    await this.proc.deleteSession(this.sessionId, 10_000);
    return true;
  }

  async destroyAndWait(): Promise<void> {
    await destroyAcp(this);
  }
}
