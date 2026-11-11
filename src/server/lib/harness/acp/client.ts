/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * One ACP agent child, driven over newline-delimited JSON-RPC on stdio.
 *
 * Deliberately NOT built on `RpcProcess`: that class speaks omp's RPC dialect
 * (`{type:"ready"}`, `{type:"response", command}`, protocol-v2 chunking), and a
 * second protocol bolted into it would make every omp path answer questions
 * about ACP. The two share only `readLines` and the kill-tree helper.
 *
 * Three behaviours here exist because a measured agent does them:
 *
 *  - **non-JSON lines on stdout.** `opencode acp` prints plugin-boot logs
 *    (`[opencode-blob-office] Plugin initialization START`) before its first
 *    frame. A strict parser failed the transport; this one skips the line.
 *  - **unsolicited notifications.** `claude-agent-acp` pushes
 *    `_auth/status_update` ~3.4 s after `initialize` with nobody asking. Unknown
 *    notifications are forwarded, never treated as errors.
 *  - **agent→client requests.** `fs/read_text_file`, `terminal/*`, and
 *    `session/request_permission` are calls the AGENT makes on the CLIENT. An
 *    unanswered one hangs the turn, so every request is either answered or
 *    explicitly refused — never dropped.
 */

import { PendingCalls } from '@/server/lib/harness/acp/calls';
import { AgentStdio } from '@/server/lib/harness/acp/stdio';
import * as verbs from '@/server/lib/harness/acp/verbs';
import { initializeAcpAgent } from '@/server/lib/harness/acp/client-initialize';
import { ACP_ERROR } from '@/server/lib/harness/acp/protocol';
import type {
  AcpId,
  AcpInitializeResult,
  AcpMcpServer,
  AcpNotification,
  AcpProtocolVersion,
  AcpRequest,
  AcpResponse,
} from '@/server/lib/harness/acp/protocol';

/** Called for every agent→client request this host knows how to answer. The
 *  boolean says "answered"; `false` makes the client reply with a refusal so the
 *  agent never waits on a dropped call. */
export type AcpClientRequestHandler = (
  id: AcpId,
  method: string,
  params: Record<string, unknown>,
) => Promise<
  | { answered: true; result: unknown }
  | { answered: false; message: string; code?: number }
  | { answered: false; deferred: true }
>;

export interface AcpClientOptions {
  command: string[];
  cwd: string;
  env?: Record<string, string>;
  /** Frame sink: `session/update` notifications and unknown notifications. */
  onNotification: (method: string, params: Record<string, unknown>) => void;
  /** Agent→client request hook, before the built-in refusals. */
  onClientRequest?: AcpClientRequestHandler;
  onStderr?: (line: string) => void;
  onExit?: (info: { code: number | null; signal: string | null; stderrTail: string }) => void;
  /** How long a client→agent request may take. Every call here is a control
   *  verb; a prompt is fire-and-await-resolve at the END of the turn, so its
   *  cap is the caller's business and is passed explicitly. */
  requestTimeoutMs?: number;
}

const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;

export class AcpProcess {
  private readonly stdio: AgentStdio;
  private readonly pending = new PendingCalls();
  private readonly options: AcpClientOptions;
  private nextId = 1;
  private exited = false;
  private writeQueue: Promise<void> = Promise.resolve();
  /** The negotiated ACP major. 1 until `initialize` answers; every verb that
   *  changed shape between versions reads it. */
  protocolVersion: AcpProtocolVersion = 1;
  /** Set once `initialize` answers, so a request sent earlier fails loudly
   *  instead of racing the handshake. */
  private initialized = false;
  /** The one `initialize` this process ever runs. A prewarmed child is handed
   *  to a session that would otherwise handshake a second time; the cached
   *  answer is what makes adopting it free. */
  private init: Promise<AcpInitializeResult> | null = null;
  /** The frame sinks, re-bindable: a prewarmed process is created before the
   *  session that will own it exists, so its handlers are attached at claim. */
  private sinks: Pick<AcpClientOptions, 'onNotification' | 'onClientRequest' | 'onExit' | 'onStderr'>;

  constructor(options: AcpClientOptions) {
    this.options = options;
    this.sinks = options;
    this.stdio = new AgentStdio(
      {
        command: options.command,
        cwd: options.cwd,
        ...(options.env ? { env: options.env } : {}),
      },
      {
        onLine: (line) => this.handleLine(line),
        onStderr: (line) => this.sinks.onStderr?.(line),
        onExit: ({ code, stderrTail }) => {
          this.exited = true;
          // The agent's own last words, when it left any: `exited (code 0)` is
          // what a shadowed/deprecated binary prints while it explains itself on
          // stderr, and without the tail the spawn failure names nothing
          // actionable.
          const detail = stderrTail.trim().split('\n').slice(-3).join(' · ');
          this.rejectAll(new Error(`ACP agent exited (code ${code})${detail ? ` — ${detail}` : ''}`));
          this.sinks.onExit?.({ code, signal: null, stderrTail });
        },
      },
    );
  }

  get isAlive(): boolean {
    return !this.exited;
  }

  get pid(): number | undefined {
    return this.stdio.pid;
  }

  /**
   * `initialize`; the client advertises exactly what it can serve.
   *
   * Idempotent: a prewarmed process has already answered, and the session that
   * adopts it must not pay a second round trip (or, worse, send a second
   * `initialize` the agent may refuse).
   */
  initialize(capabilities?: Record<string, unknown>, timeoutMs = 60_000): Promise<AcpInitializeResult> {
    this.init ??= initializeAcpAgent(this.call, capabilities, timeoutMs).then((result) => {
      this.protocolVersion = result.protocolVersion === 2 ? 2 : 1;
      this.initialized = true;
      return result;
    });
    return this.init;
  }

  /**
   * Re-bind the frame sinks.
   *
   * A prewarmed process is spawned before the session that will own it exists,
   * so its notifications and agent→client requests have nowhere to go until the
   * claim. Attaching here is what makes the warm child indistinguishable from a
   * cold one for the rest of its life.
   */
  attachSinks(sinks: Pick<AcpClientOptions, 'onNotification' | 'onClientRequest' | 'onExit' | 'onStderr'>): void {
    this.sinks = sinks;
  }

  get hasInitialized(): boolean {
    return this.initialized;
  }

  // ── protocol verbs ───────────────────────────────────────────────────────
  // Thin delegates to `verbs.ts`: the transport owns framing, the verbs own the
  // wire shape. Callers keep using `proc.newSession(...)`.

  newSession(cwd: string, timeoutMs?: number, mcpServers?: AcpMcpServer[]) {
    return verbs.newSession(this.call, cwd, timeoutMs, this.protocolVersion, mcpServers);
  }

  loadSession(sessionId: string, cwd: string, timeoutMs?: number, mcpServers?: AcpMcpServer[]) {
    return verbs.loadSession(this.call, sessionId, cwd, timeoutMs, mcpServers);
  }

  resumeSession(sessionId: string, cwd: string, timeoutMs?: number, mcpServers?: AcpMcpServer[]) {
    return verbs.resumeSession(this.call, sessionId, cwd, timeoutMs, this.protocolVersion, mcpServers);
  }

  forkSession(
    sessionId: string,
    cwd: string,
    timeoutMs?: number,
    target?: Record<string, unknown>,
    meta?: Record<string, unknown>,
    mcpServers?: AcpMcpServer[],
  ) {
    return verbs.forkSession(this.call, sessionId, cwd, timeoutMs, target, meta, mcpServers);
  }

  listSessions(cwd?: string, timeoutMs?: number) {
    return verbs.listSessions(this.call, cwd, timeoutMs);
  }

  prompt(sessionId: string, blocks: unknown[], timeoutMs?: number) {
    return verbs.prompt(this.call, sessionId, blocks, timeoutMs);
  }

  cancel(sessionId: string): void {
    verbs.cancel(this.notify, sessionId);
  }

  /** Settle this session's open `session/prompt` locally, as cancelled. The
   *  rule, and why omp forces it, live in `PendingCalls.abandonPrompt`. */
  abandonPrompt(sessionId: string): void {
    this.pending.abandonPrompt(sessionId);
  }

  setConfigOption(sessionId: string, configId: string, value: string | boolean, timeoutMs?: number) {
    return verbs.setConfigOption(this.call, sessionId, configId, value, timeoutMs, this.protocolVersion);
  }

  steer(sessionId: string, blocks: unknown[], queue?: 'steering' | 'followUp', timeoutMs?: number) {
    return verbs.steer(this.call, sessionId, blocks, queue, timeoutMs);
  }

  closeSession(sessionId: string, timeoutMs?: number) {
    return verbs.closeSession(this.call, sessionId, timeoutMs);
  }

  setMode(sessionId: string, modeId: string, timeoutMs?: number) {
    return verbs.setMode(this.call, sessionId, modeId, timeoutMs);
  }

  deleteSession(sessionId: string, timeoutMs?: number) {
    return verbs.deleteSession(this.call, sessionId, timeoutMs);
  }

  /** The invoke seam `verbs.ts` binds to. Arrow so it survives being passed. */
  readonly call = <T,>(method: string, params: unknown, timeoutMs: number): Promise<T> =>
    this.request<T>(method, params, timeoutMs);

  /** Answer an agent→client call this host handled out of band. */
  respond(id: AcpId, result: unknown): void {
    this.write({ jsonrpc: '2.0', id, result });
  }

  respondError(id: AcpId, message: string, code: number = ACP_ERROR.internal): void {
    this.write({ jsonrpc: '2.0', id, error: { code, message } });
  }

  /**
   * The notify seam `verbs.ts` binds to. Arrow, like `call`, and for the same
   * measured reason: `cancel` hands this straight to `verbs.cancel`, and a
   * method reference loses its receiver — the throw was
   * `undefined is not an object (evaluating 'this.write')` from inside
   * `notify`, so `session/cancel` was NEVER delivered and the Stop button
   * answered 500 while the turn kept running.
   */
  readonly notify = (method: string, params: unknown): void => {
    this.write({ jsonrpc: '2.0', method, params });
  };

  /** Graceful then forceful shutdown of the whole process group. */
  async dispose(gracePeriodMs = 5_000): Promise<void> {
    if (this.exited) return;
    await this.stdio.dispose(gracePeriodMs);
    this.rejectAll(new Error('ACP agent disposed'));
  }

  /** Send a client→agent request and await its result.
   *
   *  `timeoutMs` is the turn budget: `session/prompt` passes 0 because a coding
   *  turn legitimately runs for minutes, and every other verb takes the default
   *  cap. A cap of 0 disables the timer entirely. */
  private request<T>(method: string, params: unknown, timeoutMs = 0): Promise<T> {
    if (this.exited) return Promise.reject(new Error('ACP agent has exited'));
    const budget = timeoutMs > 0
      ? timeoutMs
      : method === 'session/prompt'
        ? 0
        : (this.options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS);
    const id = `k${this.nextId++}`;
    const promise = this.pending.begin<T>(id, method, params, budget);
    this.write({ jsonrpc: '2.0', id, method, params });
    return promise;
  }

  private rejectAll(error: Error): void {
    this.pending.rejectAll(error);
  }

  private write(frame: AcpRequest | AcpNotification | AcpResponse): void {
    if (this.exited) return;
    const line = `${JSON.stringify(frame)}\n`;
    // Serialized: two frames interleaved on one pipe would corrupt the stream,
    // and a closed pipe is reported by `exited` rather than thrown into the
    // queue (which would wedge every later frame).
    this.writeQueue = this.writeQueue.then(async () => {
      this.stdio.write(line);
      await this.stdio.flush();
    });
  }

  private handleLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;
    let frame: unknown;
    try {
      frame = JSON.parse(trimmed);
    } catch {
      // A measured reality: `opencode acp` writes plugin-boot logs to stdout
      // before its first frame. Skipping the line keeps the transport alive;
      // failing here made that agent unusable.
      return;
    }
    if (!frame || typeof frame !== 'object') return;
    const record = frame as Record<string, unknown>;

    if (typeof record.method === 'string') {
      // A request has BOTH id and method; a notification has method only.
      if (record.id !== undefined && record.id !== null) {
        void this.handleAgentRequest(record.id as AcpId, record.method, record.params);
      } else {
        this.sinks.onNotification(record.method, (record.params ?? {}) as Record<string, unknown>);
      }
      return;
    }

    this.pending.settle(record as unknown as AcpResponse);
  }

  /** Answer (or refuse) a call the AGENT made on this client. */
  private async handleAgentRequest(id: AcpId, method: string, params: unknown): Promise<void> {
    const bag = (params ?? {}) as Record<string, unknown>;
    try {
      const handled = await this.sinks.onClientRequest?.(id, method, bag);
      if (handled?.answered) {
        this.respond(id, handled.result);
        return;
      }
      // A deferred call is answered LATER through `respond(id, …)` — the
      // approval dialog works this way, and sending a refusal here would answer
      // the same request twice.
      if (handled && 'deferred' in handled) return;
      // A refusal is REQUIRED, not optional: an unanswered agent→client call
      // parks the turn forever (the agent's dispatcher waits on it). The code
      // travels with it so the agent can distinguish "not implemented" from
      // "that file is gone" and fall back accordingly.
      this.respondError(id, handled?.message ?? `Kabmo does not implement ${method}`, handled?.code);
    } catch (error) {
      this.respondError(id, error instanceof Error ? error.message : String(error));
    }
  }

}
