/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Settles a run omp no longer owns.
 *
 * A `stream` row is written at prompt dispatch and released by a terminal
 * `agent_end`. Two shapes break that contract, and both leave a session that
 * LOOKS finished while the sidebar spins and every client that opens it
 * resumes the generating indicator:
 *
 *   - omp ends the turn with `agent_end {isTerminal:false}` — a detached
 *     subagent, a background job, a queued continuation — and the continuation
 *     never arrives (the work it waited on went away). `streaming` then stays
 *     true for the life of the process.
 *   - the frame stream stops arriving for any other reason while the run is
 *     still open.
 *
 * Neither half of the sidebar heal can reach either shape: the row's owner is
 * THIS process and it is alive, so the staleness half sees a live pid, and the
 * orphan half only releases rows whose run this process does NOT hold — which
 * `isRunning()` says it does. `GET /api/agent/:id` cannot repair it either: a
 * busy session is answered from local flags precisely so a `get_state` cannot
 * queue up behind the running turn, so the one reconciler that reads omp's own
 * truth is never called. Measured on a real session that ended non-terminally:
 * the row survived 90s of sidebar loads, and the attach probe answered
 * `busy:true` the whole time.
 *
 * So the repair is a probe on omp's own quiescence verdict — `get_state
 * isSettled`, which is false while a run is streaming, admitted, scheduled,
 * queued or waiting on background work. Anything short of `true` changes
 * nothing (deliberately: the flags are only touched once the run is over, so a
 * mid-run probe can never blank a live run's state), and `isSettled === true`
 * settles the wrapper exactly the way a real end does.
 *
 * The clock (`RunSettle`) is fed by every frame and only probes after
 * `RUN_SILENCE_MS` of quiet; an announced retry wait (`auto_retry_start`'s
 * `delayMs`) pushes the deadline out by the wait omp itself promised, so a
 * provider retry is never mistaken for a strand.
 *
 * `handleChildExit` lives here too: an omp process that exits mid-run leaves
 * the same stranded row, and both paths are the "the run ended without a
 * terminal frame" story.
 */

import type { RpcProcess } from '@/server/lib/omp/rpc/process';
import { buildWebState, type WebStateHost } from '@/server/lib/omp/rpc/web-state';
import { GET_STATE_TIMEOUT_MS, SUBAGENT_STALE_MS, type AgentEvent, type RpcSessionState } from '@/server/lib/omp/rpc/constants';
import { markStreamStatus } from '@/shared/lib/omp/session/stream-state.server';

/**
 * Quiet stretch before a run that still claims to be live is probed. Every
 * frame resets it, and a live run emits frames constantly (token deltas, tool
 * updates, retry announcements), so this only ever elapses for a run whose
 * event stream has stopped.
 */
export const RUN_SILENCE_MS = 30_000;

/** Slack added to a retry wait omp announced, for the round trip that follows. */
export const RETRY_WAIT_SLACK_MS = 5_000;

/** Why a reconcile was asked for. Both share every gate; the distinction is
 *  documentation, not behavior. */
export type ReconcileReason = 'idle' | 'request';

/** The wrapper surface this module reads and writes. */
export interface RunSettleHost extends WebStateHost {
  sessionId: string;
  streaming: boolean;
  promptRunning: boolean;
  compacting: boolean;
  bashRunning: boolean;
  awaitingAgentStart: boolean;
  awaitingAgentStartDeadline: number;
  continuationGraceUntil: number;
  restarting: boolean;
  proc: RpcProcess;
  isAlive(): boolean;
  isRunning(): boolean;
  getPendingUiDialogs(): unknown[];
  emit(event: AgentEvent): void;
  /** The live-subagent roster. Optional so a test host can omit it; the real
   *  wrapper always provides it. `RunSettle` retires a stranded entry on omp's
   *  own quiescence verdict — a lost terminal frame otherwise holds `isBusy()`
   *  true for the whole stale window, which is what made a FINISHED session
   *  report `busy` to every client that opened it. */
  subagents?: { liveCount(now: number, staleMs: number): number; clear(): void };
}

/** The surface the child-exit path needs. */
export interface ChildExitHost {
  sessionId: string;
  restarting: boolean;
  streaming: boolean;
  promptRunning: boolean;
  isAlive(): boolean;
  emit(event: AgentEvent): void;
  destroy(): void;
}

/** Overrides for the settle clock's own timers. Production uses the constants;
 *  tests shrink them so the lifecycle rules stay fast. */
export interface RunSettleOptions {
  /** Quiet stretch before a claiming run is probed. */
  silenceMs?: number;
  /** Slack added to a retry wait omp announced. */
  retrySlackMs?: number;
}

/**
 * The clock behind {@link RunSettleHost} settling. Owns the deadline and the
 * in-flight probe flag; every decision is taken by the wrapper state it is
 * handed, so this object cannot drift from the run it describes.
 */
export class RunSettle {
  #timer: ReturnType<typeof setTimeout> | undefined;
  #lastFrameAt = Date.now();
  /** Epoch ms until which omp announced it is waiting (a provider retry). */
  #quietUntil = 0;
  #probing = false;
  readonly #host: RunSettleHost;
  readonly #silenceMs: number;
  readonly #retrySlackMs: number;

  constructor(host: RunSettleHost, options: RunSettleOptions = {}) {
    this.#host = host;
    this.#silenceMs = options.silenceMs ?? RUN_SILENCE_MS;
    this.#retrySlackMs = options.retrySlackMs ?? RETRY_WAIT_SLACK_MS;
  }

  /** Fold one frame into the clock. Called for EVERY frame, before any gate. */
  noteFrame(event: AgentEvent): void {
    this.#lastFrameAt = Date.now();
    if (event.type === 'auto_retry_start') {
      // The wait omp is about to take, announced in the frame. Probing inside it
      // would read omp between attempts — a moment when `isSettled` may well be
      // true for a run that is still very much alive.
      const delay = typeof event.delayMs === 'number' && Number.isFinite(event.delayMs) ? event.delayMs : 0;
      this.#quietUntil = this.#lastFrameAt + Math.max(0, delay) + this.#retrySlackMs;
    } else if (event.type === 'agent_start' || event.type === 'agent_end') {
      // The announced window no longer describes anything: the run continued
      // (agent_start) or ended (agent_end).
      this.#quietUntil = 0;
    }
    this.#arm();
  }

  /** Stop watching (the run ended, or the wrapper is going away). */
  stop(): void {
    clearTimeout(this.#timer);
    this.#timer = undefined;
    this.#quietUntil = 0;
  }

  /**
   * Probe omp and settle the run when omp itself reports the session quiescent.
   * Returns true when this call released a run.
   */
  async reconcile(_reason: ReconcileReason): Promise<boolean> {
    const host = this.#host;
    if (this.#probing || !host.isAlive() || host.restarting || !host.sessionId) return false;
    if (!host.isRunning()) {
      // No run in flight — but a subagent entry may still be on the roster
      // (its terminal frame was lost). omp's quiescence verdict is the only
      // thing that can retire it, and `isBusy()` reads the roster, so without
      // this probe a FINISHED session keeps reporting `busy` to every client
      // that opens it for the whole SUBAGENT_STALE_MS window.
      if (host.subagents && host.subagents.liveCount(Date.now(), SUBAGENT_STALE_MS) > 0) await this.#probeRoster();
      this.stop();
      return false;
    }
    if (host.getPendingUiDialogs().length > 0) {
      // Parked on an answer only the user can give. omp answers RPC handlers one
      // at a time, so a probe here would time out anyway — and the run is live.
      this.#arm();
      return false;
    }
    if (Date.now() - this.#lastFrameAt < this.#silenceMs || Date.now() < this.#quietUntil) {
      this.#arm();
      return false;
    }
    this.#probing = true;
    try {
      const state = await host.proc.sendCommand<RpcSessionState>({ type: 'get_state' }, GET_STATE_TIMEOUT_MS);
      // omp's own verdict, and the only thing that may settle a run: no live,
      // admitted or scheduled turn, nothing queued, no background work left.
      if (state?.isSettled !== true) {
        this.#arm();
        return false;
      }
      if (host.bashRunning) {
        // A shell command is not covered by `isSettled`; leave the session alone
        // while one is running.
        this.#arm();
        return false;
      }
      this.#settle(state);
      return true;
    } catch {
      // A wedged child (or a probe that queued behind a long handler and timed
      // out) is not evidence the run is over. The next frame or trigger retries.
      this.#arm();
      return false;
    } finally {
      this.#probing = false;
    }
  }

  /**
   * Ask omp whether the session is quiescent, and retire the subagent roster
   * when it says yes.
   *
   * Used on the no-run path: the roster can hold an entry whose terminal frame
   * was lost, which makes `isBusy()` true and every client that opens the
   * session read `busy` for the whole stale window. omp's `isSettled` covers
   * "nothing admitted, scheduled, queued or awaiting background work", so it is
   * authoritative proof no subagent is still working. A false verdict, a
   * timeout, or a wedged child leaves the roster untouched — the entries then
   * age out on their own window.
   */
  async #probeRoster(): Promise<void> {
    if (this.#probing) return;
    const roster = this.#host.subagents;
    if (!roster) return;
    this.#probing = true;
    try {
      const state = await this.#host.proc.sendCommand<RpcSessionState>({ type: 'get_state' }, GET_STATE_TIMEOUT_MS);
      if (state?.isSettled === true) roster.clear();
    } catch {
      // A probe that cannot answer is not evidence the roster is stale.
    } finally {
      this.#probing = false;
    }
  }

  /**
   * Land the settle: reconcile the flags from omp's truth, write the terminal
   * badge, and hand every attached client the terminal frame a real end sends.
   */
  #settle(state: RpcSessionState): void {
    const host = this.#host;
    const sessionId = host.sessionId;
    buildWebState(host, state);
    // `buildWebState` clears `promptRunning` only when the session reports no
    // pending work; a settled session has none, so clear the rest explicitly —
    // this wrapper must stop reporting a run nothing will ever end.
    host.streaming = false;
    host.promptRunning = false;
    host.awaitingAgentStart = false;
    host.awaitingAgentStartDeadline = 0;
    host.continuationGraceUntil = 0;
    this.stop();
    if (sessionId) void markStreamStatus(sessionId, 'finish');
    // The clients' half of the repair. A run that never ends leaves the
    // generating indicator, the optimistic sidebar mark and the withheld run
    // footer armed forever; the terminal frame is what releases them, and
    // nothing else will ever send one.
    host.emit({ type: 'agent_end', isTerminal: true, messages: [] });
  }

  /** (Re-)arm the deadline. Never keeps the event loop alive on its own. */
  #arm(): void {
    clearTimeout(this.#timer);
    this.#timer = undefined;
    if (!this.#host.isRunning()) return;
    const delayMs = Math.max(this.#silenceMs, this.#quietUntil - Date.now());
    const timer = setTimeout(() => {
      this.#timer = undefined;
      void this.reconcile('idle');
    }, delayMs);
    timer.unref?.();
    this.#timer = timer;
  }
}

/**
 * An omp process that exited mid-run: the run it was streaming will never get
 * its terminal frame, so the row and the clients are settled here. Moved out of
 * the wrapper (which is at the repo's per-file ceiling) with behavior unchanged.
 */
export function handleChildExit(host: ChildExitHost, stderrTail: string): void {
  if (!host.isAlive() || host.restarting) return;
  const detail = stderrTail.trim().split('\n').pop() ?? '';
  host.emit({
    type: 'notice',
    level: 'error',
    message: `The omp process for this session exited unexpectedly${detail ? `: ${detail}` : '.'}`,
  });
  if (host.streaming || host.promptRunning) {
    host.emit({ type: 'agent_end', isTerminal: true, messages: [] });
    if (host.sessionId) void markStreamStatus(host.sessionId, 'finish');
  }
  host.destroy();
}
