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
import { applySelections, configOption, promptBlocks } from '@/server/lib/harness/acp/prompt';
import { PendingPermissions } from '@/server/lib/harness/acp/permissions';
import { dispatchCommand, type AcpCommandHost } from '@/server/lib/harness/acp/commands';
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
}

export class AcpSession implements HarnessSession, AcpCommandHost {
  readonly harness: HarnessId;
  readonly cwd: string;
  readonly sessionFile = '';
  sessionId = '';
  /** The turn in flight — the only one whose frames are accepted. */
  private readonly turns: AcpTurns;
  runModel: { provider: string; modelId: string } | null = null;
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
    });
    this.requestedModel = options.model ?? null;
    this.requestedThinking = options.thinkingLevel ?? null;
    this.requestedMode = options.mode ?? null;
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

  /** Dispatcher seam: stop the turn. The rules live in `AcpTurns.cancel`. */
  cancelTurn(): void {
    this.turns.cancel();
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
      const current = configOption(this.configOptions, 'model')?.currentValue;
      if (typeof current === 'string') {
        const slash = current.indexOf('/');
        this.runModel = slash > 0
          ? { provider: current.slice(0, slash), modelId: current.slice(slash + 1) }
          : { provider: this.harness, modelId: current };
      }
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
    const model = configOption(this.configOptions, 'model');
    const thinking = configOption(this.configOptions, 'thought_level');
    return {
      sessionId: this.sessionId,
      isStreaming: this.isStreaming,
      isPromptRunning: this.isPromptRunning,
      isCompacting: false,
      messageCount: 0,
      model: this.runModel
        ? { id: this.runModel.modelId, provider: this.runModel.provider }
        : typeof model?.currentValue === 'string'
          ? { id: model.currentValue, provider: this.harness }
          : undefined,
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
    return this.turns.start(message, images);
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
