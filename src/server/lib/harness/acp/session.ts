/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * One live ACP session: the bridge between `AcpProcess` + `AcpFrameMapper` and
 * the `HarnessSession` contract every route already speaks.
 *
 * It owns the session's state — the id, the selectors, the model, the run flags,
 * the commands and the approval queue. The RULES live beside it, one module per
 * concern: `session-handshake.ts` (setup), `session-intake.ts` (what a prompt
 * sends), `turn.ts` (the turn), `session-config.ts`, `session-permissions.ts`,
 * `session-lifecycle.ts` and `session-web-state.ts`.
 *
 * `send()` takes the SAME command vocabulary the routes already send omp, so
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
import { LOST_SESSION_NOTICE } from '@/server/lib/harness/acp/session-lost';
import { setAcpConfig, setAcpMode, type AcpConfigWriter } from '@/server/lib/harness/acp/session-config';
import { acpConfigView, type AcpConfigProcess } from '@/server/lib/harness/acp/session-config-view';
import * as verbs from '@/server/lib/harness/acp/verbs';
import { acpPendingDialogs, answerAcpDialog } from '@/server/lib/harness/acp/session-approvals';
import { beginAcpTurn, endAcpTurn } from '@/server/lib/harness/acp/session-turns';
import { capabilitiesFrom } from '@/server/lib/harness/launch';
import { PendingPermissions } from '@/server/lib/harness/acp/permissions';
import { cancelAllAcpPermissions } from '@/server/lib/harness/acp/session-permissions';
import { handleAcpNotification } from '@/server/lib/harness/acp/session-notify';
import { RawNotificationSink, type RawNotificationListener } from '@/server/lib/harness/acp/raw-listeners';
import { AcpUsageMeter, type AcpContextUsage } from '@/server/lib/harness/acp/session-usage';
import { handleAcpClientRequest, type AcpClientRequestAnswer } from '@/server/lib/harness/acp/session-requests';
import { reportAcpExit, type AcpExitInfo } from '@/server/lib/harness/acp/session-exit';
import { acpExited, destroyAcp } from '@/server/lib/harness/acp/session-lifecycle';
import { SessionListeners } from '@/server/lib/harness/acp/session-listeners';
import type { AcpBackgroundProbe } from '@/server/lib/harness/acp/background-work';
import { acpWebState } from '@/server/lib/harness/acp/session-web-state';
import { acpIdleReaper } from '@/server/lib/harness/acp/session-idle';
import { DEFAULT_APPROVAL_MODE, isApprovalMode, type ApprovalMode } from '@/shared/lib/omp/config/access-mode';
import { dispatchCommand, type AcpCommandHost } from '@/server/lib/harness/acp/commands';
import { markStreamStatus } from '@/shared/lib/omp/session/stream-state.server';
import type { AcpSessionOptions } from '@/server/lib/harness/acp/session-options';
import type { AcpMcpServer } from '@/server/lib/harness/acp/protocol';
import type { HarnessCapabilities } from '@/server/lib/harness/capabilities';
import type { HarnessSession } from '@/server/lib/harness/session';
import type { HarnessId } from '@/shared/lib/harness/catalog';
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
    return startAcpSession(this, this.proc, this.mapper, this.replay, this.wantsReplay, this.requested, sessionIdToLoad, forkFromSessionId, forkMeta);
  }

  get protocol(): AcpProtocolVersion { return this.proc.protocolVersion === 2 ? 2 : 1; }
  /** The OS pid of the agent child, for the Stats panel's lease. */
  get pid(): number | undefined { return this.proc.pid; }
  /** Set by the handshake as soon as `initialize` answers. */
  onProtocol(version: AcpProtocolVersion): void { this.turns.completion = version === 2 ? 'state' : 'response'; }
  isAlive(): boolean { return !this.destroyed && this.proc.isAlive; }
  get isStreaming(): boolean { return this.turns.isStreaming; }
  get isPromptRunning(): boolean { return this.turns.isPromptRunning; }
  isRunning(): boolean { return this.isAlive() && (this.turns.isPromptRunning || this.turns.isStreaming); }
  isBusy(): boolean { return this.isRunning() || this.permissions.size() > 0; }
  onEvent(listener: (event: AgentEvent) => void): () => void { return this.events.add(listener); }
  /** Subscribe to the raw `session/update` payloads, before the mapper folds them. */
  onRawNotification(listener: RawNotificationListener): () => void { return this.rawSink.add(listener); }
  emit(event: AgentEvent): void { this.replay.push(event); this.events.emit(event); }
  /** Run the single destroy callback the registry installed. */
  runDestroyHook(): void { this.destroyHook?.(); }

  /** The teardown seams `session-lifecycle.ts` drives: methods, not class
   *  fields, because a test mounts the class on its prototype and a field
   *  initializer never runs there. */
  disposeProcess(): Promise<void> {
    return this.proc.dispose();
  }

  reportExit(info: AcpExitInfo): Promise<void> {
    return reportAcpExit(this, info);
  }

  /** The dispatcher's command surface — see `commands.ts` for the rules. */
  dispatch(command: Record<string, unknown>): Promise<unknown> {
    // A command is the clearest sign the session is still wanted.
    this.idle.reset();
    return dispatchCommand(this, command);
  }

  getPendingUiDialogs(): Record<string, unknown>[] {
    return acpPendingDialogs(this.permissions);
  }

  resolvePendingUiDialog(id: string): void {
    // A dialog the client dismissed is a REFUSAL, not a no-answer.
    this.resolvePermission(id, false);
  }

  onDestroy(callback: () => void): void {
    this.destroyHook = callback;
  }

  send(command: Record<string, unknown>): Promise<unknown> {
    return this.dispatch(command);
  }

  /** Dispatcher seam: one steering send. */
  steer(blocks: unknown[], queue: 'steering' | 'followUp'): Promise<unknown> {
    return this.proc.steer(this.sessionId, blocks, queue);
  }

  /** The blocks one prompt sends (text, images, `@path` links). */
  blocksFor(message: string, images: unknown): Promise<unknown[]> {
    return promptContent(this, message, images);
  }

  /** Dispatcher seam: hold an input the agent has no mid-turn channel for, so
   *  it is dispatched as the next turn instead of refused or lost. */
  queueTurnInput(message: string, images: unknown): void {
    this.turns.queue(message, images);
  }

  /** Record a mid-turn user message; the mapper drops live user frames. */
  recordUserTurn(message: string, images: unknown): void { this.emit({ type: 'user_turn', message, images }); }

  /** The durable run marker the sidebar's spinner and a reattaching tab read. A
   *  field so a unit test can stub it. */
  markStream: (status: 'stream' | 'finish' | 'abort', failure?: string | null) => void = (status, failure) => {
    if (!this.sessionId) return;
    void markStreamStatus(this.sessionId, status, status === 'stream' ? this.runModel : undefined, failure).catch(() => {});
  };

  /** Turn-end bookkeeping the panels read — see `endAcpTurn`, plus the held
   *  input that becomes the next turn. */
  onTurnEnded(info: AcpTurnEndInfo): Promise<void> {
    const reported = endAcpTurn(this, info);
    // A held input is the NEXT turn: the queue lives in the turn machine, and a
    // session that never drains it loses the message silently.
    const next = this.turns.takeQueued();
    if (next) {
      try {
        this.startTurn(next.message, next.images);
      } catch {
        // A turn that reopened first (a background interval) wins; the input is
        // dropped rather than re-queued behind an indefinite run.
      }
    }
    return reported;
  }

  /** Drop this session so the next command respawns it and resumes the agent's
   *  own history. Called when the agent reports the session is gone. */
  dropLostSession(): void {
    this.emit({ type: 'notice', level: 'warning', message: LOST_SESSION_NOTICE });
    void this.destroyAndWait();
  }

  /** Dispatcher seam: stop the turn and answer every parked approval. */
  cancelTurn(): void {
    this.background.stop();
    this.turns.cancel();
    cancelAllAcpPermissions(this.permissions, this.proc);
  }

  /** Dispatcher seam: adopt the composer's access pick. ACP answers approvals
   *  in-process, so this needs no respawn — unlike omp's spawn-time flag. */
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
    answerAcpDialog(this.permissions, this.proc, dialogId, confirmed, optionId);
    return null;
  }

  webState(): Record<string, unknown> { return acpWebState(this); }

  /** Run one turn — see `session-intake.ts` for the refusal and the ACK. */
  startTurn(message: string, images: unknown): unknown {
    return startAcpPrompt(this, message, images);
  }

  /** The seam `startAcpPrompt` opens a turn through. */
  beginTurn(message: string, images: unknown): unknown {
    return beginAcpTurn(this, this.turns, message, images);
  }

  /** One agent notification, routed — see `session-notify.ts`. */
  private onNotification(method: string, params: Record<string, unknown>): void {
    handleAcpNotification(this, method, params);
  }

  absorbUsage(update: Record<string, unknown>): void { this.usage.absorb(update); }
  resetUsageTokens(): void { this.usage.reset(); }
  acceptingFrames(): boolean { return this.replay.isActive || this.turns.acceptingFrames(); }
  mapUpdate(update: Record<string, unknown>): AgentEvent[] { return this.mapper.mapUpdate(update); }
  onStateUpdate(update: Record<string, unknown>): void { this.turns.onStateUpdate(update); this.replay.markIdle(update.state); }
  respond(id: AcpId, result: unknown): void { this.proc.respond(id, result); }
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
