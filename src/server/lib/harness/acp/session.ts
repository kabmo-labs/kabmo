/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * One live ACP session: the bridge between `AcpProcess` + `AcpFrameMapper` and
 * the `HarnessSession` contract every route already speaks.
 *
 * What it owns, and why each piece exists:
 *
 *  - **the run flags** (`promptRunning`, `streaming`). Everything downstream —
 *    the sidebar spinner, the queue's delivery gate, `isBusy()`, the idle
 *    reaper — reads these instead of asking the agent, and an ACP agent has no
 *    `get_state` to ask anyway.
 *  - **the approval queue.** `session/request_permission` BLOCKS the turn until
 *    it is answered, so a pending request is remembered (a reloaded tab must
 *    replay it) and a cancel answers it — otherwise the agent waits forever.
 *  - **the turn terminal.** ACP's only end-of-turn signal is the
 *    `session/prompt` RESPONSE. The prompt call is therefore awaited for the
 *    whole turn, and its resolution emits the `agent_end` the timeline folds.
 *
 * `send()` accepts the SAME command vocabulary the routes already send omp, so
 * `routes/agent/command.ts` needs no second dispatch table.
 */

import { AcpProcess } from '@/server/lib/harness/acp/client';
import { AcpTurns } from '@/server/lib/harness/acp/turn';
import { AcpFrameMapper } from '@/server/lib/harness/acp/frames';
import type { AcpConfigOption, AcpId, AcpSessionNewResult } from '@/server/lib/harness/acp/protocol';
import { capabilitiesFrom } from '@/server/lib/harness/launch';
import { applySelections, configOption, modelFromOption, promptBlocks } from '@/server/lib/harness/acp/prompt';
import { PendingPermissions, allowOption, autoApproval, type PermissionOption } from '@/server/lib/harness/acp/permissions';
import { DEFAULT_APPROVAL_MODE, isApprovalMode, type ApprovalMode } from '@/shared/lib/omp/config/access-mode';
import { dispatchCommand, type AcpCommandHost } from '@/server/lib/harness/acp/commands';
import { scheduleQueueDelivery } from '@/server/lib/queue/delivery.server';
import { markStreamStatus } from '@/shared/lib/omp/session/stream-state.server';
import type { HarnessCapabilities } from '@/server/lib/harness/capabilities';
import type { HarnessSession, HarnessSpawnRequest } from '@/server/lib/harness/session';
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
      onTurnEnd: (stopReason) => {
        this.endStream(stopReason);
        scheduleQueueDelivery(this);
      },
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
    const init = await this.proc.initialize({}, 60_000);
    let session: AcpSessionNewResult;
    if (sessionIdToLoad) {
      await this.proc.loadSession(sessionIdToLoad, this.cwd, 120_000);
      // `session/load` replays the transcript as `session/update` frames, which
      // the mapper has already turned into rows. The reply carries the
      // (possibly unchanged) config list.
      const reloaded = await this.proc.newSession(this.cwd).catch(() => null);
      session = reloaded ?? { sessionId: sessionIdToLoad };
    } else {
      session = await this.proc.newSession(this.cwd, 120_000);
    }
    this.sessionId = session.sessionId || sessionIdToLoad || '';
    this.configOptions = session.configOptions ?? [];
    // Seed the run's model from the selector the agent ALREADY reports. Nothing
    // is written yet at this point, so without the seed `runModel` stayed null
    // until some later config write — and `webState()` then answered
    // `provider: 'omp-acp'` (the harness id) with the whole `provider/model`
    // string as the model id, which is what the generating indicator names.
    this.runModel = modelFromOption(configOption(this.configOptions, 'model'), this.harness);
    this.capabilities = capabilitiesFrom(init, this.configOptions, { usage: false, plan: false });
    await applySelections(this, {
      model: this.requestedModel,
      thinking: this.requestedThinking,
      mode: this.requestedMode,
    });
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

  /**
   * Close the durable run marker at turn end: a cancelled turn is an `abort`
   * badge, every other ending a `finish`.
   */
  endStream(stopReason: string | undefined): void {
    this.markStream(stopReason === 'cancelled' ? 'abort' : 'finish');
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

  /** Dispatcher seam: write one config selector and adopt the answer.
   *
   *  The agent's reply carries the whole config list, and the model selector's
   *  `currentValue` is the model it RESOLVED — which is what the run indicator
   *  must report, since an alias or a fallback can differ from the request.
   */
  async setConfig(configId: string, value: string | boolean): Promise<unknown> {
    const result = await this.proc.setConfigOption(this.sessionId, configId, value);
    if (result && typeof result === 'object' && 'configOptions' in result && Array.isArray(result.configOptions)) {
      this.configOptions = result.configOptions as AcpConfigOption[];
      const resolved = modelFromOption(configOption(this.configOptions, 'model'), this.harness);
      if (resolved) this.runModel = resolved;
    }
    return result;
  }

  /** Dispatcher seam: answer a pending approval dialog.
   *
   *  Every exit answers the agent: a chosen option becomes
   *  `{outcome:"selected"}`, and an id nobody knows becomes `cancelled` — the
   *  agent is parked on this call and a silent return would hang it.
   */
  resolvePermission(dialogId: string, confirmed: boolean): unknown {
    const entry = this.permissions.take(dialogId);
    if (!entry) return null;
    const chosen = this.permissions.optionFor(entry, confirmed);
    this.proc.respond(entry.id, {
      outcome: chosen ? { outcome: 'selected', optionId: chosen.optionId } : { outcome: 'cancelled' },
    });
    return null;
  }

  webState(): Record<string, unknown> {
    const thinking = configOption(this.configOptions, 'thought_level');
    // The run's model is seeded at `start()` and refreshed by every config
    // write, so this is the value the agent RESOLVED. The fallback exists only
    // for a session whose selector list never carried a model.
    const serving = this.runModel ?? modelFromOption(configOption(this.configOptions, 'model'), this.harness);
    return {
      sessionId: this.sessionId,
      isStreaming: this.isStreaming,
      isPromptRunning: this.isPromptRunning,
      isCompacting: false,
      messageCount: 0,
      model: serving ? { id: serving.modelId, provider: serving.provider } : undefined,
      thinkingLevel: typeof thinking?.currentValue === 'string' ? thinking.currentValue : undefined,
      configOptions: this.configOptions,
    };
  }

  /** Run one turn. The promise IS the turn: ACP resolves `session/prompt` when
   *  the agent is done, so the reply is awaited for its whole duration.
   *
   *  A second prompt while one runs is REFUSED here rather than sent: ACP would
   *  accept it and CANCEL the first turn (measured), throwing away the answer
   *  the user is reading. The refusal is the same wording omp uses, so the
   *  client's queue/steer recovery path is unchanged.
   *
   *  The DISPATCH answers an ACK, never the turn. `prompt` over the HTTP route
   *  means "accepted" to every client — `sendNewPrompt` adopts the session id
   *  and wires its stream on that answer — so returning the turn here parked a
   *  brand-new ACP chat on `new-…` for the answer's whole duration: measured on
   *  opencode, the URL stayed `?sessionId=new-…`, the docked indicator read
   *  "Loading" and the transcript never appeared, while the turn itself was
   *  running fine. omp's own `prompt` returns an ack for the same reason; the
   *  turn's end is reported by the `agent_end` frame below.
   */
  startTurn(message: string, images: unknown): unknown {
    const ack = this.turns.start(message, images);
    // After the start, not before: `turns.start` throws when a turn is already
    // open, and a marker written for a refused prompt would spin the sidebar
    // over a run that never existed.
    this.markStream('stream');
    return ack;
  }

  private onNotification(method: string, params: Record<string, unknown>): void {
    if (method !== 'session/update') return;
    // No turn open: the user stopped it (or one is still queued), and anything
    // the agent keeps emitting belongs to work nobody is watching. Forwarding it
    // reopened the assistant message after Stop and streamed abandoned text into
    // a transcript the client had already finalized.
    if (!this.turns.acceptingFrames()) return;
    const update = params.update;
    if (!update || typeof update !== 'object') return;
    for (const event of this.mapper.mapUpdate(update as Record<string, unknown>)) this.emit(event);
    if ((update as Record<string, unknown>).sessionUpdate === 'usage_update') {
      this.capabilities = { ...this.capabilities, hasUsage: true };
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
      // A tier that allows this kind is answered HERE, before a dialog exists:
      // parking it would ask a question the operator's own selection already
      // answered, and `isBusy()` would report a dialog nobody is meant to see.
      const toolCall = params.toolCall && typeof params.toolCall === 'object'
        ? Object.fromEntries(Object.entries(params.toolCall))
        : undefined;
      if (autoApproval(this.accessMode, toolCall)) {
        const options = Array.isArray(params.options) ? (params.options as PermissionOption[]) : [];
        const optionId = allowOption(options);
        if (optionId) {
          return Promise.resolve({
            answered: true,
            result: { outcome: { outcome: 'selected', optionId } },
          });
        }
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

export async function openAcpSession(
  options: AcpSessionOptions,
  request: HarnessSpawnRequest,
): Promise<{ session: AcpSession; realSessionId: string }> {
  const session = new AcpSession(options, request.cwd);
  const { sessionId } = await session.start(request.sessionFile || undefined);
  return { session, realSessionId: sessionId };
}
