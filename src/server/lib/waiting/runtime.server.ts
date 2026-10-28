/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The waiting-prompt clock: a prompt held until another session finishes.
 *
 * Same shape as the scheduled-task runtime, and for the same reason — omp has
 * no notion of a prompt that has not been sent, so the wait is Kabmo's own and
 * has to outlive the tab that created it. A client-side watcher would be gone
 * on reload, invisible to a second tab, and unable to survive a closed browser.
 *
 * Two triggers keep it moving, plus a tick:
 *
 *   1. a dependency's run end (`terminal-settle.ts`) schedules a sweep, so the
 *      normal case dispatches within a second;
 *   2. the follow-up queue's delivery path schedules one when it drains, so a
 *      dependency that had a queue of its own is not waited on past its last
 *      prompt;
 *   3. a 5 s tick covers a lost timer, a restart, and a dependency that ends
 *      while this process was not watching (a second Kabmo instance owns the
 *      child, but the ROW is shared).
 *
 * The claim in `store.server.ts` is what makes several processes safe: only the
 * caller whose UPDATE changed the row may spawn.
 */

import {
  startNewRpcSession,
  type AgentSessionWrapper,
} from '@/server/lib/omp/rpc/manager';
import { getRpcSession } from '@/server/lib/omp/rpc/session-registry';
import { kabmoModeEnv } from '@/server/lib/omp/extensions/locator';
import { hasQueuedItem } from '@/server/lib/queue/store.server';
import { hasPendingDelivery } from '@/server/lib/queue/delivery.server';
import { applyModelSnapshot, promptCommand } from '@/server/lib/queue/payload';
import { loadStreamStates } from '@/shared/lib/omp/session/stream-state.server';
import { streamRowWrittenAt } from '@/server/lib/waiting/row-clock.server';
import type { ApprovalMode } from '@/shared/lib/omp/config/access-mode';
import { loadPersistedAccessMode } from '@/shared/lib/omp/config/access-mode.server';
import { emitRealtimeSignal } from '@/server/lib/realtime/signals.server';
import { publishSidebarStructure } from '@/server/lib/realtime/topics.server';
import { withTimeout } from '@/server/lib/util/with-timeout';
import { dependencyVerdict, type DependencyState } from '@/server/lib/waiting/settle';
import { setWaitingSweepHandler } from '@/server/lib/waiting/sweep-trigger';
import {
  claimWaitingPrompt,
  countWaitingAttempt,
  failWaitingPrompt,
  listWaitingPrompts,
  markWaitingDispatched,
  pruneWaitingPrompts,
  requeueWaitingPrompt,
} from '@/server/lib/waiting/store.server';
import type { WaitingPrompt } from '@/shared/types/waiting';

/** How often the clock is consulted. */
const TICK_MS = 5_000;

/** Delay before the first tick: boot work owns the first seconds. */
const FIRST_TICK_DELAY_MS = 3_000;

/** How long a spawn + delivery may take before the attempt is called failed. */
const DISPATCH_TIMEOUT_MS = 120_000;

/** A prompt whose dispatch failed this many times is reported, not retried. */
export const MAX_DISPATCH_ATTEMPTS = 3;

/** The prompt-sending surface a dispatch needs; narrower than the wrapper so a
 *  test can drive the whole path without spawning a process. */
export interface WaitingSessionHandle {
  send(command: Record<string, unknown>): Promise<unknown>;
}

/**
 * Everything a dispatch reaches outside this module, injected rather than
 * imported at the call site — the same reason `ScheduleDeps` is: `mock.module`
 * would swap the registry entry for every other suite in the same `bun test`
 * run, and the store and the spawn path are both process-wide singletons.
 */
export interface WaitingDeps {
  startNewRpcSession(
    cwd: string,
    mode?: ApprovalMode,
    modeEnv?: Record<string, string>,
  ): Promise<{ session: WaitingSessionHandle; realSessionId: string }>;
  getSession(sessionId: string): AgentSessionWrapper | undefined;
  loadStreamStates(): Promise<StreamRowMap>;
  /** Epoch ms of a session's last status write, or null when unknown. */
  streamRowWrittenAt(sessionId: string): Promise<number | null>;
  hasQueuedItem(sessionId: string): Promise<boolean>;
  hasPendingDelivery(sessionId: string): boolean;
  loadPersistedAccessMode(): Promise<ApprovalMode>;
  listWaitingPrompts(): Promise<WaitingPrompt[]>;
  claimWaitingPrompt(id: string): Promise<boolean>;
  countWaitingAttempt(id: string): Promise<number>;
  markWaitingDispatched(id: string, sessionId: string): Promise<void>;
  requeueWaitingPrompt(id: string, error: string): Promise<void>;
  failWaitingPrompt(id: string, error: string): Promise<void>;
  pruneWaitingPrompts(): Promise<number>;
}

/**
 * Built lazily, never as a module-level constant.
 *
 * `terminal-settle.ts` imports this module (a run end schedules a sweep) and
 * this module reaches back into the RPC registry — a cycle. Reading the spawn
 * function while the registry module is still evaluating would capture an
 * uninitialized binding, so the object is assembled at call time instead.
 */
function defaultDeps(): WaitingDeps {
  return {
    startNewRpcSession,
    getSession: getRpcSession,
    loadStreamStates,
    streamRowWrittenAt,
    hasQueuedItem,
    hasPendingDelivery,
    loadPersistedAccessMode,
    listWaitingPrompts: () => listWaitingPrompts(),
    claimWaitingPrompt,
    countWaitingAttempt,
    markWaitingDispatched,
    requeueWaitingPrompt,
    failWaitingPrompt,
    pruneWaitingPrompts: () => pruneWaitingPrompts(),
  };
}

interface WaitingRuntimeSlot {
  timer: ReturnType<typeof setInterval> | null;
  /** In-flight sweep, so a slow dispatch does not overlap the next tick. */
  sweeping: boolean;
  /** A one-shot sweep requested by a run end, coalesced. */
  pending: ReturnType<typeof setTimeout> | null;
}

declare global {
  // eslint-disable-next-line no-var
  var __kabmoWaitingRuntime: WaitingRuntimeSlot | undefined;
}

function slot(): WaitingRuntimeSlot {
  return (globalThis.__kabmoWaitingRuntime ??= { timer: null, sweeping: false, pending: null });
}

/** One session's stream row, as the dependency check reads it. */
export interface StreamRow {
  status: 'stream' | 'finish' | 'abort';
}

/** The stream rows keyed by session id — one read serves a whole sweep. */
export type StreamRowMap = Record<string, StreamRow>;

/** The dependency's state, as `settle.ts` reads it. */
export async function readDependencyState(
  sessionId: string,
  deps: WaitingDeps,
  streams?: StreamRowMap,
): Promise<DependencyState> {
  const rows = streams ?? (await deps.loadStreamStates());
  const wrapper = deps.getSession(sessionId);
  return {
    stream: rows[sessionId],
    rowWrittenAt: await deps.streamRowWrittenAt(sessionId),
    busy: wrapper ? wrapper.isBusy() : false,
    queued: await deps.hasQueuedItem(sessionId),
    delivering: deps.hasPendingDelivery(sessionId),
  };
}

/**
 * Spawn the session this prompt belongs to and send it.
 *
 * The prompt is assembled by `queue/payload.ts`, the same builder the follow-up
 * queue uses: both send a prompt nobody typed in this tab, from the same
 * persisted shape.
 */
async function dispatchWaitingPrompt(
  prompt: WaitingPrompt,
  deps: WaitingDeps,
): Promise<{ sessionId: string }> {
  const accessMode = prompt.model?.accessMode ?? (await deps.loadPersistedAccessMode());
  const modeEnv = prompt.modes ? kabmoModeEnv(prompt.modes) : undefined;
  const { session, realSessionId } = await deps.startNewRpcSession(prompt.cwd, accessMode, modeEnv);
  // A CLOSURE, never `session.send` itself: the wrapper's `send` reaches its own
  // runtime state through `this`, so passing the method detached makes it run
  // against `undefined` — measured as `undefined is not an object (evaluating
  // 'host.restarting')` and a prompt recorded as failed.
  const send = (command: Record<string, unknown>) => session.send(command);
  await applyModelSnapshot(send, prompt.model);
  await send(promptCommand({ text: prompt.prompt, attachments: prompt.attachments, model: prompt.model }));
  return { sessionId: realSessionId };
}

/**
 * Sweep every waiting prompt whose dependency has provably finished.
 *
 * Serial on purpose: the claim already decided who may spawn, and several
 * omp children booting at once fight over the CPU the first one needs.
 */
export async function sweepWaitingPrompts(
  options: { now?: number; deps?: WaitingDeps } = {},
): Promise<number> {
  const deps = options.deps ?? defaultDeps();
  const now = options.now ?? Date.now();
  const waiting = (await deps.listWaitingPrompts()).filter((prompt) => prompt.status === 'waiting');
  if (waiting.length === 0) return 0;

  // One stream read for the whole pass: the rows are one table, and every
  // prompt names a session id in it.
  const streams = await deps.loadStreamStates();
  let dispatched = 0;
  for (const prompt of waiting) {
    const state = await readDependencyState(prompt.dependsOn, deps, streams);
    if (!dependencyVerdict(state, now).settled) continue;
    if (!(await deps.claimWaitingPrompt(prompt.id))) continue;
    try {
      const { sessionId } = await withTimeout(
        dispatchWaitingPrompt(prompt, deps),
        DISPATCH_TIMEOUT_MS,
        'The waiting prompt was not accepted in time.',
      );
      await deps.markWaitingDispatched(prompt.id, sessionId);
      dispatched += 1;
      // The session exists but omp has not written its transcript: the sidebar
      // row has to come from the structure republish, exactly as it does for a
      // spawn the composer started.
      publishSidebarStructure();
      emitRealtimeSignal('session-attached', sessionId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const attempts = await deps.countWaitingAttempt(prompt.id);
      if (attempts >= MAX_DISPATCH_ATTEMPTS) {
        await deps.failWaitingPrompt(prompt.id, message);
      } else {
        // The prompt has NOT been delivered: returning it to `waiting` retries
        // on the next sweep rather than dropping a prompt the user still wants.
        await deps.requeueWaitingPrompt(prompt.id, message);
      }
    }
    emitRealtimeSignal('waiting-changed');
  }
  // Retention is checked on the same pass: a terminal row is only needed long
  // enough for the client that created it to read the outcome.
  void deps.pruneWaitingPrompts().catch(() => {});
  return dispatched;
}

/** Run one sweep, coalescing a burst of triggers into one pass. */
function sweepOnce(deps: WaitingDeps): void {
  const state = slot();
  if (state.sweeping) return;
  state.sweeping = true;
  sweepWaitingPrompts({ deps })
    .catch((error) => console.error('[waiting] sweep failed:', error))
    .finally(() => {
      state.sweeping = false;
    });
}

/**
 * Ask for a sweep shortly. Called when a run ends and when a queue drains.
 *
 * The delay is the dependency's own settle grace: sweeping instantly would find
 * the row it just watched end still inside its grace window and do nothing.
 */
export function scheduleWaitingSweep(delayMs = 1_600): void {
  const state = slot();
  if (state.pending) clearTimeout(state.pending);
  state.pending = setTimeout(() => {
    state.pending = null;
    sweepOnce(defaultDeps());
  }, delayMs);
  state.pending.unref();
}

/** Start the tick. Idempotent: a second call is a no-op while one is running. */
export function startWaitingRuntime(): void {
  const state = slot();
  if (state.timer) return;
  // The queue's delivery path asks for a sweep through this slot rather than by
  // importing this module: it would close a cycle, because this one reads the
  // queue to decide whether a dependency still has work.
  setWaitingSweepHandler((delayMs) => scheduleWaitingSweep(delayMs));
  const tick = () => sweepOnce(defaultDeps());
  setTimeout(tick, FIRST_TICK_DELAY_MS).unref();
  state.timer = setInterval(tick, TICK_MS);
  // A timer must never hold the process open: the listener is what keeps the
  // server alive, and a shutdown should not wait for the next tick.
  state.timer.unref();
}

/** Stop the tick (shutdown, tests). */
export function stopWaitingRuntime(): void {
  const state = slot();
  setWaitingSweepHandler(null);
  if (state.pending) {
    clearTimeout(state.pending);
    state.pending = null;
  }
  if (state.timer) {
    clearInterval(state.timer);
    state.timer = null;
  }
}

/** Whether a prompt's dependency currently looks settled (the route's guard). */
export async function isDependencySettled(sessionId: string, deps: WaitingDeps = defaultDeps()): Promise<boolean> {
  return dependencyVerdict(await readDependencyState(sessionId, deps)).settled;
}

