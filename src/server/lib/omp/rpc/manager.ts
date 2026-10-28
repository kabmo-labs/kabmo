/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Session RPC manager for Kabmo — the analog of omp-web's
 * lib/rpc-manager.ts. Wraps one spawned `omp --mode rpc-ui` process per
 * session with the command surface Kabmo chat needs: prompt, abort,
 * abort_and_prompt, set_model, set_thinking_level, get_state, and the
 * passthrough set. Event frames (agent_start/agent_end/message_update/...)
 * are forwarded to SSE subscribers via onEvent.
 *
 * Scoped down from omp-web: host tools, URI schemes, extension widgets, MCP
 * list, and branch/fork are omitted (Kabmo does not surface them yet).
 */

import { RpcProcess, type RpcFrame } from '@/server/lib/omp/rpc/process';
import { configureChild } from '@/server/lib/omp/rpc/child-config';
import { PendingUiDialogs } from '@/server/lib/omp/rpc/pending-ui-dialogs';
import { foldSessionFrame } from '@/server/lib/omp/rpc/frame-fold';
import { dispatchSessionCommand } from '@/server/lib/omp/rpc/session-commands';
import { SubagentLiveness } from '@/server/lib/omp/rpc/subagent-liveness';
import { ModeMirror } from '@/server/lib/omp/rpc/mode-mirror';
import { IdleReaper } from '@/server/lib/omp/rpc/idle-reaper';
import { AgentStartWatchdog } from '@/server/lib/omp/rpc/agent-start-watchdog';
import { RunSettle, handleChildExit } from '@/server/lib/omp/rpc/run-settle.server';
import { EventFanout } from '@/server/lib/omp/rpc/event-fanout';
import { syncRunModel as syncRunModelFor } from '@/server/lib/omp/rpc/run-model';
import { reloadChildPlugins } from '@/server/lib/omp/rpc/reload-plugins';
import { clearStreamStatus, type SessionRunModel } from '@/shared/lib/omp/session/stream-state.server';
import { GET_STATE_TIMEOUT_MS, IDLE_REAP_MS, READY_TIMEOUT_MS, SUBAGENT_STALE_MS, type AgentEvent, type EventListener, type RpcSessionState } from '@/server/lib/omp/rpc/constants';

export type {
  AgentEvent,
  EventListener,
  RpcSessionState,
  WebSessionState,
} from '@/server/lib/omp/rpc/constants';
export { WebRpcError, resolveSpawnCwd } from '@/server/lib/omp/rpc/constants';

/** Overrides for the wrapper's own timers. Production always uses the
 *  constant; tests shrink the window so the lifecycle rules stay fast. */
export interface AgentSessionWrapperOptions {
  /** Idle window before an unused process is reclaimed. */
  idleDestroyMs?: number;
}

export class AgentSessionWrapper {
  private readonly fanout = new EventFanout();
  promptRunning = false;
  promptDispatchPendingCount = 0;
  awaitingAgentStart = false;
  awaitingAgentStartDeadline = 0;
  /** Watches the deadline above so a dispatch whose turn never opens cannot
   *  strand the session (see `AgentStartWatchdog`). */
  private readonly agentStartWatchdog: AgentStartWatchdog;
  /** Settles a run omp no longer owns (see `run-settle.server.ts`). */
  readonly runSettle: RunSettle;
  continuationGraceUntil = 0;
  bashRunning = false;
  streaming = false;
  compacting = false;
  fastModeEnabled = false;
  runModel: SessionRunModel | null = null;
  private onDestroyCallback: (() => void) | null = null;
  private unsubscribeFrames: (() => void) | null = null;
  private initPromise: Promise<void> | null = null;
  restarting = false;
  private _alive = true;
  destroyPromise: Promise<void> | null = null;
  private _sessionId = '';
  private _sessionFile = '';
  // Ask/approval dialogs omp is currently blocked on. omp never re-delivers an
  // `extension_ui_request`, so a client that reloads mid-dialog can only learn
  // the id it must answer from here.
  private readonly pendingUiDialogs = new PendingUiDialogs();
  // Live subagents, folded from the frames omp streams after the subscription
  // set in initialize(). No other flag on this wrapper can see them, and an
  // idle reclaim or a spawn-mode reconcile must never kill a running subagent.
  // Public so `RunSettle` can retire a stranded entry on omp's own quiescence
  // verdict (see `run-settle.server.ts`).
  readonly subagents = new SubagentLiveness();
  // The `/rename` dispatch chain (see `session/title-request.server.ts`): a
  // prompt after the run end waits here so the rename goes first.
  autoTitleDispatch: Promise<void> | null = null;
  /** omp's own plan/goal mode, mirrored from the frames. */
  readonly modeMirror = new ModeMirror();
  // One-shot: the FIRST run is the only one Kabmo may ask omp to name from.
  // Seeded in applyIdentity from omp's own message count, so a child resumed
  // with `--resume` (which reports the messages it restored) never re-titles.
  autoTitlePending = true;
  // True once this run's early attempt was made, so a queued steer cannot
  // re-ask inside the run. Reset at each `agent_start`.
  autoTitleRequested = false;
  // Epoch ms until which `command_output` frames belong to our own rename.
  autoTitleWindowUntil = 0;
  // Outstanding requests, one claim each: both attempts can be unanswered at
  // once, and one slot let the first one's output reach the timeline.
  autoTitleClaims = 0;
  /** The pin a title request runs under (see `auto-title.server.ts`). A GETTER
   *  over `runModel`: `get_state`, the `set_model` ack and the fallback probe all
   *  write that one field, and a second copy would pin a model the session left. */
  get autoTitleModel(): SessionRunModel | null {
    return this.runModel;
  }
  /** Idle reclaim. Its own object because the rules are self-contained: a busy
   *  session is never reclaimed, and every frame defers the deadline. */
  readonly idle: IdleReaper;
  proc: RpcProcess;
  readonly cwd: string;
  private readonly recordedCwd: string | null;

  constructor(proc: RpcProcess, cwd: string, recordedCwd?: string | null, options: AgentSessionWrapperOptions = {}) {
    this.proc = proc;
    this.cwd = cwd;
    this.recordedCwd = recordedCwd ?? null;
    this.idle = new IdleReaper(options.idleDestroyMs ?? IDLE_REAP_MS, () => {
      if (this.isBusy()) return false;
      this.destroy();
      return true;
    });
    this.agentStartWatchdog = new AgentStartWatchdog(this, () => {
      // The deadline passed with no frame settling the dispatch. Clear the
      // flags AND the row: the row's owner is this LIVE process, so the
      // sidebar heal can never reach it.
      this.promptRunning = false;
      this.awaitingAgentStart = false;
      this.awaitingAgentStartDeadline = 0;
      if (this.sessionId) void clearStreamStatus(this.sessionId);
    });
    this.runSettle = new RunSettle(this);
  }

  get sessionId(): string {
    return this._sessionId;
  }

  get sessionFile(): string {
    return this._sessionFile;
  }

  isAlive(): boolean {
    return this._alive && this.proc.isAlive;
  }

  /** OS pid of this session's omp process; the key into the shared browser's
   * per-process target registry. */
  get pid(): number | undefined {
    return this.proc.pid;
  }

  isRunning(): boolean {
    return this.isAlive() && (this.promptRunning || this.streaming || this.compacting || this.bashRunning);
  }

  /** Anything in flight that a process reset would destroy: the current turn,
   *  a compaction, a shell command, live subagents — which outlive the turn that
   *  spawned them, so no other flag here can see them — or an ask/approval dialog
   *  omp is BLOCKED on.
   *
   *  The dialogs are the load-bearing entry: an ask parks the tool call for as
   *  long as the user takes to answer, and omp answers RPC handlers one at a
   *  time, so every probe (`get_state`) queues behind it and times out. Without
   *  this the timeout path read the session as "idle and unresponsive", killed
   *  the child, and with it the question the user was still reading. */
  isBusy(): boolean {
    return (
      this.isRunning() ||
      this.pendingUiDialogs.list().length > 0 ||
      this.subagents.liveCount(Date.now(), SUBAGENT_STALE_MS) > 0
    );
  }

  /**
   * Watchdog for a dispatch whose turn never opened. The clock lives in its own
   * object (`AgentStartWatchdog`) because "did it actually settle?" is a
   * question only this wrapper can answer; this method only feeds it the flags.
   * See that module for the failure it exists to close.
   */
  armAgentStartWatchdog(): void {
    this.agentStartWatchdog.arm();
  }

  start(): void {
    this.unsubscribeFrames = this.proc.onFrame((frame) => this.handleFrame(frame));
    this.idle.reset();
  }

  /** Resolves once the child announced readiness and identity is known. */
  waitUntilReady(): Promise<void> {
    if (!this.initPromise) this.initPromise = this.initialize();
    return this.initPromise;
  }

  private async initialize(): Promise<void> {
    const ready = await this.proc.waitReady(READY_TIMEOUT_MS);
    await this.proc.negotiateProtocol(ready);
    await configureChild(this.proc);
    const state = await this.proc.sendCommand<RpcSessionState>({ type: 'get_state' }, GET_STATE_TIMEOUT_MS);
    this.applyIdentity(state);
    if (this.recordedCwd && this.recordedCwd !== this.cwd) {
      this.emit({
        type: 'notice',
        level: 'warning',
        message: `This session's working directory no longer exists; the agent is running in ${this.cwd}.`,
      });
    }
  }

  private applyIdentity(state: RpcSessionState): void {
    this._sessionId = state.sessionId;
    this._sessionFile = state.sessionFile ?? '';
    this.streaming = state.isStreaming;
    this.compacting = state.isCompacting;
    this.fastModeEnabled = state.fastModeEnabled ?? state.fastMode ?? this.fastModeEnabled;
    if (state.model) this.runModel = { provider: state.model.provider, modelId: state.model.id };
    // omp reports the messages it restored, so a child spawned for an EXISTING
    // conversation (a `--resume` after the idle reclaim, or a session opened
    // from the sidebar) already has a first turn behind it — it must never be
    // titled from whatever the operator asks next. Only a conversation with no
    // messages at all is eligible, which is exactly the fresh-spawn case.
    this.autoTitlePending = state.messageCount === 0;
  }

  handleProcessExit(stderrTail: string): void {
    handleChildExit(this, stderrTail);
  }

  /** SessionFrameHost adapter: remember a blocking dialog for reattaching clients. */
  trackUiDialog(frame: AgentEvent): void {
    this.pendingUiDialogs.track(frame);
  }

  /** SessionFrameHost adapter: fold a subagent frame into the liveness roster. */
  observeSubagent(frame: AgentEvent, now: number): void {
    this.subagents.observe(frame, now);
  }

  private handleFrame(frame: RpcFrame): void {
    this.idle.reset();
    const event = frame as AgentEvent;
    // The state machine and its settle-time side effects live in frame-fold.ts;
    // this method owns only the wrapper's own bookkeeping around it.
    const { suppressForward } = foldSessionFrame(this, event);
    // The run-settle clock reads every frame: it is what tells a quiet run from
    // one whose event stream stopped, and it is fed the retry waits omp
    // announces. See `run-settle.server.ts`.
    this.runSettle.noteFrame(event);
    // A frame settled the dispatch (agent_start cleared `awaitingAgentStart` and
    // set `streaming`; prompt_result cleared it too), so the watchdog has
    // nothing left to do.
    this.agentStartWatchdog.settleIfDone();
    // `suppressForward` withholds only the FRAME — a failed prompt response
    // already emitted its own `prompt_error`, and Kabmo's own background
    // rename must not surface its diagnostics.
    if (!suppressForward) this.emit(event);
  }

  emit(event: AgentEvent): void {
    this.fanout.emit(event);
  }

  onEvent(listener: EventListener): () => void {
    return this.fanout.on(listener);
  }

  /** Dialogs omp is still blocked on, oldest first. A client reattaching to a
   *  live session replays these so the modal it lost on reload comes back. */
  getPendingUiDialogs(): RpcFrame[] {
    return this.pendingUiDialogs.list();
  }

  /** Forget a dialog once its response is on the wire. */
  resolvePendingUiDialog(id: string): void {
    this.pendingUiDialogs.resolve(id);
  }

  onDestroy(cb: () => void): void {
    this.onDestroyCallback = cb;
  }

  /** Persist the session identity omp reports in a get_state payload. */
  adoptSessionIdentity(state: RpcSessionState): void {
    if (!state.sessionId) return;
    this._sessionId = state.sessionId;
    this._sessionFile = state.sessionFile ?? this._sessionFile;
    if (state.model) this.runModel = { provider: state.model.provider, modelId: state.model.id };
  }

  /** Delegate; the fallback-chain rationale lives in `run-model.ts`. */
  syncRunModel(): void {
    syncRunModelFor(this);
  }

  async send(command: Record<string, unknown>): Promise<unknown> {
    return dispatchSessionCommand(this, command);
  }

  /** Delegate; `reload-plugins.ts` holds why this is not a dispatched turn. */
  async reloadPlugins(): Promise<boolean> {
    return reloadChildPlugins(this);
  }

  destroy(): void {
    void this.destroyAndWait();
  }

  /** Destroy and resolve only after the omp child has fully exited. Callers
   * that delete the session file afterwards must await this — omp flushes
   * session state on shutdown and would otherwise recreate the file. */
  async destroyAndWait(): Promise<void> {
    if (this.destroyPromise) return this.destroyPromise;
    if (!this._alive) return;
    // Read the run flags BEFORE `_alive` flips: `isRunning()` consults it, so
    // after the flip it can only ever answer false.
    const wasRunning = this.isRunning();
    const sessionId = this._sessionId;
    this._alive = false;
    this.idle.stop();
    this.unsubscribeFrames?.();
    this.pendingUiDialogs.clear();
    this.agentStartWatchdog.stop();
    this.runSettle.stop();
    this.promptDispatchPendingCount = 0;
    this.awaitingAgentStart = false;
    this.awaitingAgentStartDeadline = 0;
    this.continuationGraceUntil = 0;
    // A torn-down wrapper can never settle the run its row describes: no
    // `agent_end` will arrive, and the row's owner (THIS process) stays alive,
    // so neither half of the sidebar heal can ever reach it. Every destroy
    // path lands here — the Stop escalation (`force_reset`), a rewind or
    // delete that tears the child down before rewriting the file, and the
    // timeout reset — so this is the one place that closes the leak for all of
    // them. Released only while the wrapper still held a run: a destroy of an
    // idle wrapper must not delete a row a fresh dispatch has already written.
    //
    // Concurrent with the process teardown, and awaited with it, so a caller
    // that reads the row after `destroyAndWait` sees the released state while a
    // wedged database can never keep the child alive.
    const released = wasRunning && sessionId ? clearStreamStatus(sessionId) : Promise.resolve();
    const disposed = this.proc.dispose().catch(() => {});
    this.destroyPromise = disposed;
    await Promise.all([disposed, released]);
    this.onDestroyCallback?.();
  }
}

export { getRpcSession, startRpcSession, startNewRpcSession } from '@/server/lib/omp/rpc/session-registry';
export { getSpawnApprovalMode, getSpawnModeEnv, reconcileSpawnApprovalMode } from '@/server/lib/omp/rpc/spawn-provenance';
