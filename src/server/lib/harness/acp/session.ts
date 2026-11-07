/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * One live ACP session: the bridge between `AcpProcess` + `AcpFrameMapper` and
 * the `HarnessSession` contract every route already speaks.
 *
 * It owns the session's own state — the id, the config selectors, the resolved
 * model, the run flags the sidebar spinner and the queue's delivery gate read,
 * the agent's command list, and the approval queue a reloaded tab replays. The
 * RULES for each of those live beside it, one module per concern:
 * `session-handshake.ts` (initialize/new/load + the picks), `session-turns.ts`
 * (the ACK contract and turn-end bookkeeping), `session-config.ts` (adopting a
 * config answer, answering a parked dialog), `session-permissions.ts` (the
 * tier that answers before a dialog exists), `session-facts.ts` (the metadata an
 * agent publishes about itself between turns) and `session-web-state.ts`
 * (`get_state`, in the shape the omp transport reports it).
 *
 * `send()` accepts the SAME command vocabulary the routes already send omp, so
 * `routes/agent/command.ts` needs no second dispatch table.
 */

import { AcpProcess } from '@/server/lib/harness/acp/client';
import { AcpTurns } from '@/server/lib/harness/acp/turn';
import { AcpFrameMapper } from '@/server/lib/harness/acp/frames';
import type { AcpConfigOption, AcpId } from '@/server/lib/harness/acp/protocol';
import { promptBlocks } from '@/server/lib/harness/acp/prompt';
import { adoptConfigOptions, settlePermissionDialog } from '@/server/lib/harness/acp/session-config';
import { beginAcpTurn, settleAcpTurn } from '@/server/lib/harness/acp/session-turns';
import { handshakeAcpSession } from '@/server/lib/harness/acp/session-handshake';
import { capabilitiesFrom } from '@/server/lib/harness/launch';
import { PendingPermissions } from '@/server/lib/harness/acp/permissions';
import { metadataCapabilities, parseAgentCommands } from '@/server/lib/harness/acp/session-facts';
import { preApprovedOption } from '@/server/lib/harness/acp/session-permissions';
import { acpWebState } from '@/server/lib/harness/acp/session-web-state';
import { noteAgentTitle } from '@/server/lib/harness/session-title.server';
import { DEFAULT_APPROVAL_MODE, isApprovalMode, type ApprovalMode } from '@/shared/lib/omp/config/access-mode';
import { dispatchCommand, type AcpCommandHost } from '@/server/lib/harness/acp/commands';
import { markStreamStatus } from '@/shared/lib/omp/session/stream-state.server';
import type { HarnessCapabilities } from '@/server/lib/harness/capabilities';
import type { HarnessSession } from '@/server/lib/harness/session';
import type { HarnessId } from '@/shared/lib/harness/catalog';
import type { AgentEvent } from '@/server/lib/omp/rpc/constants';

export interface AcpSessionOptions {
  harness: HarnessId;
  command: string[];
  env?: Record<string, string>;
  /** Provider/model this session starts on, applied with
   *  `session/set_config_option` right after `session/new`. */
  model?: { provider: string; modelId: string } | null;
  thinkingLevel?: string | null;
  mode?: string | null;
  /** The composer's access pick. ACP has no spawn flag for it, so the session
   *  answers `session/request_permission` itself according to this tier. */
  accessMode?: ApprovalMode | null;
}

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
  /** Messages this session has moved: prompts sent plus assistant messages the
   *  mapper closed. omp reports the same quantity from its transcript. */
  messageCount = 0;
  /** The composer's approval tier. Answered in-process by {@link onClientRequest}. */
  accessMode: ApprovalMode = DEFAULT_APPROVAL_MODE;
  capabilities: HarnessCapabilities = capabilitiesFrom({ protocolVersion: 1 }, [], { usage: false, plan: false });
  configOptions: AcpConfigOption[] = [];

  private readonly proc: AcpProcess;
  private readonly mapper = new AcpFrameMapper();
  private readonly listeners = new Set<(event: AgentEvent) => void>();
  private readonly permissions = new PendingPermissions();
  private destroyHook: (() => void) | null = null;
  private destroyed = false;
  /** Set when Kabmo is the one ending the process, so the exit is not reported
   *  as an agent failure. `force_reset` is the Stop button's escalation, and the
   *  user must not get an "agent exited" error for a stop they asked for. */
  private closing = false;

  constructor(options: AcpSessionOptions, cwd: string) {
    this.harness = options.harness;
    this.cwd = cwd;
    this.proc = new AcpProcess({
      command: options.command,
      cwd,
      ...(options.env ? { env: options.env } : {}),
      onNotification: (method, params) => this.onNotification(method, params),
      onClientRequest: (id, method, params) => this.onClientRequest(id, method, params),
      onExit: (info) => this.onExit(info),
    });
    this.turns = new AcpTurns({
      emit: (event) => this.emit(event),
      prompt: (message, images) =>
        this.proc.prompt(this.sessionId, promptBlocks(message, images), 0) as Promise<{ stopReason?: string } | undefined>,
      cancelAgent: () => this.proc.cancel(this.sessionId),
      abandonPrompt: () => this.proc.abandonPrompt(this.sessionId),
      resetMapper: () => this.mapper.reset(),
      closeMessage: () => this.mapper.closeMessage(),
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
  async start(sessionIdToLoad?: string): Promise<{ sessionId: string }> {
    await handshakeAcpSession(
      this,
      this.proc,
      { model: this.requestedModel, thinking: this.requestedThinking, mode: this.requestedMode },
      sessionIdToLoad,
    );
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
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event: AgentEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // One throwing subscriber must not starve the others.
      }
    }
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
   *  turn closes the marker as an `abort` badge, every other ending a `finish`. */
  onTurnEnded(info: { stopReason?: string; closedMessage: boolean }): void {
    settleAcpTurn(this, info);
  }

  /** Dispatcher seam: stop the turn. The rules live in `AcpTurns.cancel`. */
  cancelTurn(): void {
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
    adoptConfigOptions(this, result);
    return result;
  }

  /** Dispatcher seam: answer a pending approval dialog. Every exit answers the
   *  agent — a silent return would hang it (see `session-config.ts`). */
  resolvePermission(dialogId: string, confirmed: boolean): unknown {
    settlePermissionDialog(this.permissions, this.proc, dialogId, confirmed);
    return null;
  }

  webState(): Record<string, unknown> {
    return acpWebState({
      sessionId: this.sessionId,
      isStreaming: this.isStreaming,
      isPromptRunning: this.isPromptRunning,
      messageCount: this.messageCount,
      runModel: this.runModel,
      configOptions: this.configOptions,
      harness: this.harness,
    });
  }

  /** Run one turn. The promise IS the turn: ACP resolves `session/prompt` when
   *  the agent is done, so the reply is awaited for its whole duration. The ACK,
   *  the refusal of a second prompt and the end bookkeeping are stated in
   *  `session-turns.ts`.
   */
  startTurn(message: string, images: unknown): unknown {
    return beginAcpTurn(this, this.turns, message, images);
  }

  private onNotification(method: string, params: Record<string, unknown>): void {
    if (method !== 'session/update') return;
    const update = params.update;
    if (!update || typeof update !== 'object') return;
    const record = update as Record<string, unknown>;
    const kind = typeof record.sessionUpdate === 'string' ? record.sessionUpdate : '';

    // Session METADATA arrives between turns — omp publishes its command list
    // and a usage update right after `session/new`, when no turn is open. The
    // turn gate below exists so abandoned output cannot reopen a finalized
    // message; applying it to these dropped the composer's `/` pool and the
    // panels' capability flags entirely.
    if (kind === 'available_commands_update') this.agentCommands = parseAgentCommands(record);
    const absorbed = metadataCapabilities(this.capabilities, kind);
    if (absorbed !== this.capabilities) this.capabilities = absorbed;
    // The agent's own name for this chat arrives BETWEEN turns (measured on
    // claude: after the first answer), where the turn gate below would drop it.
    // Persisted here so the sidebar row can say it — and it outranks the guess
    // `notePromptTitle` made from the first prompt.
    if (kind === 'session_info_update' && typeof record.title === 'string' && this.sessionId) {
      void noteAgentTitle(this.sessionId, record.title);
    }

    // No turn open: the user stopped it (or one is still queued), and anything
    // the agent keeps emitting belongs to work nobody is watching. Forwarding it
    // reopened the assistant message after Stop and streamed abandoned text into
    // a transcript the client had already finalized.
    if (!this.turns.acceptingFrames()) return;
    for (const event of this.mapper.mapUpdate(record)) {
      this.emit(event);
      if (event.type === 'message_end') this.messageCount += 1;
    }
  }

  /** Agent→client requests. Every branch answers or refuses — an unanswered call
   *  parks the turn, which is the failure this method exists to prevent. */
  private onClientRequest(
    id: AcpId,
    method: string,
    params: Record<string, unknown>,
  ): Promise<{ answered: true; result: unknown } | { answered: false; message: string } | { answered: false; deferred: true }> {
    if (method === 'session/request_permission') {
      const optionId = preApprovedOption(this.accessMode, params);
      if (optionId) {
        return Promise.resolve({
          answered: true,
          result: { outcome: { outcome: 'selected', optionId } },
        });
      }
      // The dialog id IS the JSON-RPC id: the answer arrives later through
      // `extension_ui_response`, and it has to name the exact parked call.
      const dialog = this.permissions.add(id, String(params.sessionId ?? this.sessionId), params);
      this.emit(dialog as unknown as AgentEvent);
      // Answered LATER; the transport must not send a refusal now or the agent
      // sees two answers to one request.
      return Promise.resolve({ answered: false, deferred: true });
    }
    return Promise.resolve({ answered: false, message: `Kabmo does not implement ${method}` });
  }

  private onExit(info: { code: number | null; stderrTail: string }): void {
    this.destroyed = true;
    if (this.closing) {
      this.destroyHook?.();
      return;
    }
    const detail = info.stderrTail.trim().split('\n').slice(-3).join(' · ');
    this.emit({
      type: 'prompt_error',
      errorMessage: detail || `The ${this.harness} agent exited (code ${info.code ?? 'signal'})`,
    });
    this.emit({ type: 'agent_end', isTerminal: true });
    this.destroyHook?.();
  }

  destroy(): void {
    void this.destroyAndWait();
  }

  async destroyAndWait(): Promise<void> {
    if (this.destroyed) return;
    this.destroyed = true;
    this.closing = true;
    this.permissions.clear();
    await this.proc.dispose().catch(() => {});
    this.destroyHook?.();
  }
}
