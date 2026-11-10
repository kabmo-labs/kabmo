/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * One live ACP session: the bridge between `AcpProcess` + `AcpFrameMapper` and
 * the `HarnessSession` contract every route already speaks.
 *
 * It owns the session's own state — the id, the config selectors, the resolved
 * model, the run flags the sidebar spinner and the queue delivery gate read, the
 * agent's commands and the approval queue a reloaded tab replays. The RULES live
 * beside it, one module per concern: `session-handshake.ts` (initialize/new/load
 * + the picks), `session-turns.ts` (the ACK contract and turn-end bookkeeping),
 * `session-config.ts` (config answers, parked dialogs), `session-permissions.ts`
 * (the tier that answers before a dialog exists), `session-facts.ts` (what an
 * agent publishes between turns) and `session-web-state.ts` (`get_state`).
 *
 * `send()` takes the SAME command vocabulary the routes already send omp, so
 * `routes/agent/command.ts` needs no second dispatch table.
 */

import { AcpProcess } from '@/server/lib/harness/acp/client';
import { AcpTurns, type AcpTurnEndInfo } from '@/server/lib/harness/acp/turn';
import { AcpFrameMapper } from '@/server/lib/harness/acp/frames';
import type { AcpConfigOption, AcpId } from '@/server/lib/harness/acp/protocol';
import { promptBlocks } from '@/server/lib/harness/acp/prompt';
import { withGatewayCompatibility } from '@/server/lib/harness/acp/gateway-env';
import { adoptConfigAnswer, publishConfigChange, settlePermissionDialog, stampMessageModel } from '@/server/lib/harness/acp/session-config';
import { beginAcpTurn, settleAcpTurn } from '@/server/lib/harness/acp/session-turns';
import { driveAcpGoalAfterTurn } from '@/server/lib/harness/acp/acp-goal-driver.server';
import { handshakeAcpSession } from '@/server/lib/harness/acp/session-handshake';
import { capabilitiesFrom } from '@/server/lib/harness/launch';
import { PendingPermissions } from '@/server/lib/harness/acp/permissions';
import { handleSessionNotification } from '@/server/lib/harness/acp/session-notifications';
import { AcpUsageMeter, type AcpContextUsage } from '@/server/lib/harness/acp/session-usage';
import { handleAcpClientRequest, type AcpClientRequestAnswer } from '@/server/lib/harness/acp/session-requests';
import { acpExitFailureFrames } from '@/server/lib/harness/acp/session-exit';
import { SessionListeners } from '@/server/lib/harness/acp/session-listeners';
import {
  AcpBackgroundProbe,
  BACKGROUND_LOAD_TIMEOUT_MS,
  assistantTextOf,
  deliverBackgroundNotice,
  spawnsBackgroundWork,
} from '@/server/lib/harness/acp/background-work';
import { acpWebState } from '@/server/lib/harness/acp/session-web-state';
import { acpIdleReaper } from '@/server/lib/harness/acp/session-idle';
import { DEFAULT_APPROVAL_MODE, isApprovalMode, type ApprovalMode } from '@/shared/lib/omp/config/access-mode';
import { dispatchCommand, type AcpCommandHost } from '@/server/lib/harness/acp/commands';
import { markStreamStatus } from '@/shared/lib/omp/session/stream-state.server';
import type { AcpSessionOptions } from '@/server/lib/harness/acp/session-options';
import type { HarnessCapabilities } from '@/server/lib/harness/capabilities';
import type { HarnessSession } from '@/server/lib/harness/session';
import type { HarnessId } from '@/shared/lib/harness/catalog';
import type { AgentEvent } from '@/server/lib/omp/rpc/constants';
import type { IdleReaper } from '@/server/lib/omp/rpc/idle-reaper';

export class AcpSession implements HarnessSession, AcpCommandHost {
  readonly harness: HarnessId;
  readonly cwd: string;
  readonly sessionFile = '';
  sessionId = '';
  /** The turn in flight — the only one whose frames are accepted. */
  private readonly turns: AcpTurns;
  runModel: { provider: string; modelId: string } | null = null;
  /** The agent's own slash-command list, from `available_commands_update`; the
   *  composer's `/` pool reads it for this session (omp's utility child answers
   *  that question for the RPC transport). */
  agentCommands: { name: string; description?: string; inputHint?: string }[] = [];
  /** The agent's plan entries from `session/update plan`, as published. The
   *  Todos panel renders them through the same payload omp's transcript
   *  snapshot produces. */
  planEntries: unknown[] = [];
  /** Messages this session has moved: prompts sent plus assistant messages the
   *  mapper closed. omp reports the same quantity from its transcript. */
  messageCount = 0;
  /** Prompts this session dispatched — the telemetry panel's user count. */
  promptCount = 0;
  /** Assistant messages the mapper closed, for the same panel. */
  assistantCount = 0;
  /** The last `usage_update` the agent reported, or null when it never did. */
  private readonly usage = new AcpUsageMeter();

  get contextUsage(): AcpContextUsage | null {
    return this.usage.contextUsage;
  }

  get totalCost(): number {
    return this.usage.totalCost;
  }

  get usageTokens(): number {
    return this.usage.usageTokens;
  }
  /** The composer's approval tier. Answered in-process by {@link onClientRequest}. */
  accessMode: ApprovalMode = DEFAULT_APPROVAL_MODE;
  capabilities: HarnessCapabilities = capabilitiesFrom({ protocolVersion: 1 }, [], { usage: false, plan: false });
  configOptions: AcpConfigOption[] = [];
  private readonly proc: AcpProcess;
  /** The quiet-window reclaim; the rules live in `session-idle.ts`. */
  readonly idle: IdleReaper;
  /** Watches for work that finishes after `end_turn`; see `background-work.ts`. */
  private readonly background: AcpBackgroundProbe;
  private readonly mapper = new AcpFrameMapper();
  private readonly events = new SessionListeners();
  readonly permissions = new PendingPermissions();
  private destroyHook: (() => void) | null = null;
  private destroyed = false;
  /** Set when Kabmo is the one ending the process, so the exit is not reported
   *  as an agent failure. `force_reset` is the Stop button's escalation, and the
   *  user must not get an "agent exited" error for a stop they asked for. */
  private closing = false;

  constructor(options: AcpSessionOptions, cwd: string) {
    this.harness = options.harness;
    this.cwd = cwd;
    const env = withGatewayCompatibility(options.harness, options.env);
    this.proc = new AcpProcess({
      command: options.command,
      cwd,
      ...(env ? { env } : {}),
      onNotification: (method, params) => this.onNotification(method, params),
      onClientRequest: (id, method, params) => this.onClientRequest(id, method, params),
      onExit: (info) => this.onExit(info),
    });
    this.idle = acpIdleReaper(this, options.idleDestroyMs);
    // ACP holds updates produced while idle until the next request, so a turn
    // that spawned a subagent is followed by a `session/load` probe. The replay
    // is swallowed by the probe; only the text past the answer already shown is
    // emitted, as the agent's continuation.
    this.background = new AcpBackgroundProbe({
      load: () => this.proc.loadSession(this.sessionId, this.cwd, BACKGROUND_LOAD_TIMEOUT_MS),
      resetIdle: () => this.idle.reset(),
      emit: (text) => deliverBackgroundNotice(this, text),
    });
    this.turns = new AcpTurns({
      emit: (event) => this.emit(event),
      prompt: (message, images) =>
        this.proc.prompt(this.sessionId, promptBlocks(message, images), 0) as Promise<{ stopReason?: string } | undefined>,
      cancelAgent: () => this.proc.cancel(this.sessionId),
      abandonPrompt: () => this.proc.abandonPrompt(this.sessionId),
      resetMapper: () => this.mapper.reset(),
      closeMessage: () => this.mapper.closeMessage().map((event) => stampMessageModel(event, this.runModel)),
      openCalls: () => this.mapper.openCalls(),
      // The follow-up queue is armed from the turn's END, exactly as the omp
      // wrapper arms it from its own terminal settle. Without this an ACP chat's
      // queued follow-up stayed in `queued_messages` forever: nothing on this
      // transport scheduled a delivery, and the client's nudge route only knew
      // omp's wrapper.
      onTurnEnd: (info) => this.onTurnEnded(info),
    });
    this.requestedModel = options.model ?? null;
    this.requestedThinking = options.thinkingLevel ?? null;
    this.requestedMode = options.mode ?? null;
    this.accessMode = isApprovalMode(options.accessMode) ? options.accessMode : DEFAULT_APPROVAL_MODE;
  }

  private readonly requestedModel: { provider: string; modelId: string } | null;
  private readonly requestedThinking: string | null;
  private readonly requestedMode: string | null;
  /** `initialize` + `session/new|load|resume`, then the requested selections. */
  async start(sessionIdToLoad?: string, forkFromSessionId?: string): Promise<{ sessionId: string }> {
    await handshakeAcpSession(
      this,
      this.proc,
      { model: this.requestedModel, thinking: this.requestedThinking, mode: this.requestedMode },
      sessionIdToLoad,
      forkFromSessionId,
    );
    // A slow handshake is not idleness: the window starts once it is usable.
    this.idle.reset(true);
    return { sessionId: this.sessionId };
  }

  isAlive(): boolean {
    return !this.destroyed && this.proc.isAlive;
  }

  get isStreaming(): boolean {
    return this.turns.isStreaming;
  }

  get isPromptRunning(): boolean {
    return this.turns.isPromptRunning;
  }

  isRunning(): boolean {
    return this.isAlive() && (this.turns.isPromptRunning || this.turns.isStreaming);
  }

  isBusy(): boolean {
    return this.isRunning() || this.permissions.size() > 0;
  }

  onEvent(listener: (event: AgentEvent) => void): () => void {
    return this.events.add(listener);
  }

  emit(event: AgentEvent): void {
    this.events.emit(event);
  }

  getPendingUiDialogs(): Record<string, unknown>[] {
    // Widened for the shared `HarnessSession` contract, which predates the
    // dialog shape; every field the client reads is present.
    return this.permissions.pendingDialogs() as unknown as Record<string, unknown>[];
  }

  resolvePendingUiDialog(id: string): void {
    // A dialog the client dismissed is a REFUSAL, not a no-answer.
    this.resolvePermission(id, false);
  }

  onDestroy(callback: () => void): void {
    this.destroyHook = callback;
  }

  async send(command: Record<string, unknown>): Promise<unknown> {
    // A command is the clearest sign the session is still wanted.
    this.idle.reset();
    return dispatchCommand(this, command);
  }

  /** Dispatcher seam: one steering send. */
  steer(blocks: unknown[], queue: 'steering' | 'followUp'): Promise<unknown> {
    return this.proc.steer(this.sessionId, blocks, queue);
  }

  /**
   * The durable run marker (`session_stream_state`), the row the sidebar's
   * spinner and a reattaching tab's "still running" answer read. A field so a
   * unit test can stub it: the default writes the same row omp's dispatch writes.
   */
  markStream: (status: 'stream' | 'finish' | 'abort') => void = (status) => {
    if (!this.sessionId) return;
    void markStreamStatus(this.sessionId, status, status === 'stream' ? this.runModel : undefined).catch(() => {});
  };

  /** Turn-end bookkeeping the panels read — see `session-turns.ts`. A cancelled
   *  turn closes the marker as an `abort` badge, every other ending a `finish`.
   *  The goal driver then audits the closed message and may open the next turn. */
  onTurnEnded(info: AcpTurnEndInfo): void {
    if (info.closedMessage) this.assistantCount += 1;
    this.usage.endTurn();
    settleAcpTurn(this, info);
    // A subagent outlives the turn that spawned it: antigravity answers
    // `end_turn` right after `invoke_subagent`, and its completion is held
    // until the next request (upstream #1461). Probe the transcript instead.
    if (!info.cancelled && info.failed !== true && spawnsBackgroundWork(info.message)) {
      this.background.start(assistantTextOf(info.message));
    }
    void driveAcpGoalAfterTurn(this, info.message, { cancelled: info.cancelled === true }).catch(() => {});
  }

  /** Dispatcher seam: stop the turn. The rules live in `AcpTurns.cancel`. */
  cancelTurn(): void {
    this.background.stop();
    this.turns.cancel();
  }

  /** Dispatcher seam: adopt the composer's access pick. ACP answers approvals
   *  in-process, so this needs no respawn — unlike omp's spawn-time flag. */
  setAccessMode(mode: ApprovalMode): void {
    this.accessMode = mode;
  }

  /** Dispatcher seam: write one config selector and adopt the answer — see
   *  `session-config.ts` for why the AGENT's resolved value is what is kept. */
  async setConfig(configId: string, value: string | boolean): Promise<unknown> {
    const result = await this.proc.setConfigOption(this.sessionId, configId, value);
    adoptConfigAnswer(this, result, { configId, value });
    publishConfigChange(this, configId);
    return result;
  }

  /** Dispatcher seam: answer a pending approval dialog. Every exit answers the
   *  agent — a silent return would hang it (see `session-config.ts`). */
  resolvePermission(dialogId: string, confirmed: boolean): unknown {
    settlePermissionDialog(this.permissions, this.proc, dialogId, confirmed);
    return null;
  }

  webState(): Record<string, unknown> {
    return acpWebState(this);
  }

  /** Run one turn. The promise IS the turn: ACP resolves `session/prompt` when
   *  the agent is done, so the reply is awaited for its whole duration. The ACK,
   *  the refusal of a second prompt and the end bookkeeping are stated in
   *  `session-turns.ts`.
   */
  startTurn(message: string, images: unknown): unknown {
    // A new prompt is the next request, so the agent flushes any held update
    // itself; a probe would duplicate it.
    this.background.stop();
    this.promptCount += 1;
    this.usage.beginTurn();
    return beginAcpTurn(this, this.turns, message, images);
  }

  private onNotification(method: string, params: Record<string, unknown>): void {
    // A long turn emits no commands but plenty of `session/update` frames.
    this.idle.reset();
    // A `session/load` replay repeats the whole chat; leave it to the probe.
    if (this.background.consume(method, params)) return;
    handleSessionNotification(this, method, params);
  }

  absorbUsage(update: Record<string, unknown>): void { this.usage.absorb(update); }
  resetUsageTokens(): void { this.usage.reset(); }
  acceptingFrames(): boolean { return this.turns.acceptingFrames(); }

  mapUpdate(update: Record<string, unknown>): AgentEvent[] { return this.mapper.mapUpdate(update); }

  /** Agent→client requests: every branch answers or refuses — an unanswered call parks the turn. */
  private onClientRequest(
    id: AcpId,
    method: string,
    params: Record<string, unknown>,
  ): Promise<AcpClientRequestAnswer> {
    this.idle.reset();
    return handleAcpClientRequest(this, id, method, params);
  }

  private onExit(info: { code: number | null; stderrTail: string }): void {
    this.destroyed = true;
    this.background.stop();
    this.idle.stop();
    if (!this.closing) {
      for (const event of acpExitFailureFrames(this.harness, info)) this.emit(event);
    }
    this.destroyHook?.();
  }

  destroy(): void {
    void this.destroyAndWait();
  }

  async destroyAndWait(): Promise<void> {
    if (this.destroyed) return;
    this.destroyed = true;
    this.closing = true;
    this.background.stop();
    this.idle.stop();
    this.permissions.clear();
    await this.proc.dispose().catch(() => {});
    this.destroyHook?.();
  }
}
