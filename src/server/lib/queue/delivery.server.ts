/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Server-side follow-up queue auto-delivery: the run's own `agent_end` — as
 * observed by the session wrapper, the process that owns the omp child —
 * triggers the next queued prompt. This replaces the client-driven
 * auto-delivery whose state races (tab reload wiping the table, session
 * switches sending a queue into the wrong session) made queued messages
 * disappear or land in the wrong conversation.
 *
 * Semantics:
 * - The head is CLAIMED (transactional DELETE) before dispatch, so a second
 *   trigger — another tab's nudge, a racing run end — can never double-send.
 * - A failed dispatch re-inserts the item at the head; nothing is lost.
 * - A user Stop clears the pending-delivery timer instead of delivering (the
 *   item stays claimed-but-returned... it is re-queued first), so stop-all
 *   semantics live on the server now.
 */

import { claimHeadQueueItem, hasQueuedItem, requeueHeadQueueItem } from '@/server/lib/queue/store.server';
import { applyModelSnapshot, promptCommand } from '@/server/lib/queue/payload';
import { requestWaitingSweep } from '@/server/lib/waiting/sweep-trigger';
import type { QueuedMessage } from '@/shared/types/chat';

/** Settling time between agent_end and the next prompt dispatch. Small on
 *  purpose: omp's own turn-end bookkeeping (JSONL flush, title slot) runs on
 *  the same child, and an instant dispatch races it. */
const DELIVERY_DELAY_MS = 500;

/**
 * How long a scheduled-but-not-yet-run delivery may sit before the next
 * trigger supersedes it.
 *
 * Without this, one lost timer wedges the session's queue FOREVER: the guard
 * below early-returns on any existing entry, so nothing would ever schedule
 * again. A timer can be lost without the process dying — a wedged event loop
 * drops the callback — and the symptom is silent: the queue simply never
 * drains and no error is reported. Past this bound the entry is presumed lost
 * and rescheduled, so a client nudge (sent whenever a session with queued
 * items mounts or regains focus) always recovers the queue.
 *
 * This covers only a timer that never RUNS. A delivery that runs and cannot
 * proceed re-arms itself (see {@link DELIVERY_RETRY_MS}); the two paths are
 * independent, so neither depends on a client trigger arriving.
 */
const DELIVERY_STALE_MS = 5_000;

/**
 * Retry interval for a delivery that could not run: the session was busy at its
 * tick, or the attempt itself failed.
 *
 * A busy session is the common case, not an edge one — a subagent outlives the
 * parent turn's `agent_end`, a compaction runs after it, and an ask/approval
 * dialog parks it indefinitely — and every one of those is exactly when the
 * run-end trigger fires. `isBusy()` is an in-memory flag read, so polling it
 * costs nothing; the alternative (a wake hook per busy source) would need
 * re-wiring every time a new source is added.
 */
const DELIVERY_RETRY_MS = 2_000;

interface PendingDelivery {
  timer: ReturnType<typeof setTimeout>;
  /** Wall-clock after which this entry is presumed lost and superseded. */
  expiresAt: number;
}

declare global {
  // eslint-disable-next-line no-var
  var __ompQueueDeliveryTimers: Map<string, PendingDelivery> | undefined;
}

/** Per-session pending delivery timer, so a second agent_end while one is
 *  already scheduled cannot double-book the head.
 *
 *  On `globalThis` for the same reason the session registry is: a `bun --hot`
 *  soft reload re-evaluates this module but keeps globalThis, so a module-local
 *  map would silently orphan every pending entry — the reloaded module would
 *  see an empty map, `clearPendingTimer` could no longer cancel the orphan, and
 *  the session's queue would stall with nothing logged. */
function getPendingTimers(): Map<string, PendingDelivery> {
  if (!globalThis.__ompQueueDeliveryTimers) globalThis.__ompQueueDeliveryTimers = new Map();
  return globalThis.__ompQueueDeliveryTimers;
}

function clearPendingTimer(sessionId: string): void {
  const pendingTimers = getPendingTimers();
  const entry = pendingTimers.get(sessionId);
  if (entry === undefined) return;
  clearTimeout(entry.timer);
  pendingTimers.delete(sessionId);
}

/** Send one queued item to the session as a normal prompt. The model snapshot
 *  rides first (set_model / set_thinking_level) exactly like the composer's
 *  queued delivery did. Returns false when the dispatch failed.
 *
 *  The command itself is built by `queue/payload.ts`, shared with the waiting
 *  prompt's dispatcher: both send a prompt nobody typed in this tab, from the
 *  same persisted shape. */
async function dispatchQueuedItem(session: QueueDeliveryHost, item: QueuedMessage): Promise<boolean> {
  // BOUND, never passed detached: the wrapper's `send` reaches its own runtime
  // state through `this`, so `applyModelSnapshot(session.send, …)` ran it against
  // `undefined` — measured in production as `undefined is not an object
  // (evaluating 'e.restarting')` on every queued item that carried a model
  // snapshot. The item was then re-queued and retried every 2s forever, and the
  // client's nudge hit the same path, so the follow-up never left the queue and
  // only a manual re-send got it out. The waiting-prompt dispatcher binds for the
  // same reason (`waiting/runtime.server.ts`).
  const send = session.send.bind(session);
  try {
    await applyModelSnapshot(send, item.model);
    await send(promptCommand({ text: item.text, attachments: item.attachments, model: item.model }));
    return true;
  } catch (error) {
    console.error(`[queue] delivery failed for session ${session.sessionId}:`, error);
    return false;
  }
}

/** Minimal surface delivery needs from a live session wrapper. */
export interface QueueDeliveryHost {
  sessionId: string;
  isAlive(): boolean;
  isBusy(): boolean;
  send(command: Record<string, unknown>): Promise<unknown>;
}

/**
 * Schedule the next queued delivery for this session. Called on terminal
 * agent_end and on a client's mount nudge. Idempotent: an in-flight timer is
 * reused, a claimed head can only be won by one caller.
 *
 * A pending entry older than {@link DELIVERY_STALE_MS} is presumed lost (see
 * that constant) and replaced, so a dropped timer delays the queue instead of
 * wedging it.
 */
export function scheduleQueueDelivery(session: QueueDeliveryHost): void {
  const sessionId = session.sessionId;
  if (!sessionId) return;
  const pendingTimers = getPendingTimers();
  const pending = pendingTimers.get(sessionId);
  if (pending !== undefined) {
    if (Date.now() < pending.expiresAt) return;
    // Lost timer: clear it so its callback cannot also fire and double-deliver.
    clearTimeout(pending.timer);
  }
  armDelivery(session, DELIVERY_DELAY_MS);
}

/**
 * Deliver the head right now, with no timer involved. Returns whether an item
 * was actually sent.
 *
 * The nudge route's entry point: the failure a nudge recovers from is a lost
 * timer, so the nudge itself must not depend on one. Busy sessions re-arm the
 * normal retry (which is timer-based, and harmless — the nudge is a bonus path,
 * not the only one), and an empty queue is a no-op.
 */
export async function deliverQueueNow(session: QueueDeliveryHost): Promise<boolean> {
  return deliverNext(session);
}

/** Arm (or re-arm) this session's delivery tick. */
function armDelivery(session: QueueDeliveryHost, delayMs: number): void {
  const sessionId = session.sessionId;
  const pendingTimers = getPendingTimers();
  const timer = setTimeout(() => {
    pendingTimers.delete(sessionId);
    // The attempt is fire-and-forget from the timer's perspective, but it must
    // never reject silently: an unhandled rejection here is how a throwing
    // `claimHeadQueueItem` (a `getDbSync()` before the db is resolved) or a
    // failing RPC turned into a queue that simply stopped draining with nothing
    // in the log. `deliverNext` owns its own failure handling; this catch is
    // the last resort so the failure is at least reported.
    deliverNext(session).catch((error) => {
      console.error(`[queue] delivery attempt failed for session ${sessionId}:`, error);
    });
  }, delayMs);
  pendingTimers.set(sessionId, { timer, expiresAt: Date.now() + DELIVERY_STALE_MS });
}

/**
 * Re-arm the retry, but only while there is still something to deliver.
 *
 * A busy session whose queue emptied in the meantime (another tab took the
 * head, or the user deleted the row) must not leave a poll loop running
 * forever.
 */
async function armRetryIfQueued(session: QueueDeliveryHost): Promise<void> {
  if (await hasQueuedItem(session.sessionId)) armDelivery(session, DELIVERY_RETRY_MS);
}

/**
 * Deliver the head, or re-arm and try again later. True when an item was sent.
 *
 * A busy session is the normal case at the moment this runs — the run-end that
 * scheduled it fires while a subagent, a compaction or an ask dialog is still
 * live, and `isBusy()` is true for all three. Returning there is what used to
 * strand the queue permanently: the timer had already been deleted from the map
 * by its own callback, so nothing remained to retry it and no later trigger was
 * guaranteed to arrive. Re-arming keeps the retry owned by this module.
 */
async function deliverNext(session: QueueDeliveryHost): Promise<boolean> {
  const sessionId = session.sessionId;
  if (!session.isAlive()) return false;
  if (session.isBusy()) {
    await armRetryIfQueued(session);
    return false;
  }
  const item = await claimHeadQueueItem(sessionId);
  if (!item) {
    // The queue just drained: a prompt held until this session finished may now
    // be free to go. The sweep re-checks the queue itself, so requesting one
    // here cannot release a prompt ahead of an item that is still waiting.
    requestWaitingSweep();
    return false;
  }
  const ok = await dispatchQueuedItem(session, item);
  if (!ok) {
    await requeueHeadQueueItem(sessionId, item);
    // The dispatch threw (provider error, dead child). Retry on the same cadence
    // a busy session gets, so a transient failure drains without user action.
    await armRetryIfQueued(session);
    return false;
  }
  // This delivery may have been the last one: ask for a sweep so a dependent
  // prompt does not sit until the next tick after the queue emptied.
  requestWaitingSweep();
  return true;
}

/**
 * Whether this process already holds a delivery slot for the session.
 *
 * Read by the waiting-prompt sweep: a run end arms a delivery 500 ms out, so a
 * dependency that looks settled for a moment may still have its queued
 * follow-up about to go out. Waiting for the slot to clear is what keeps a
 * dependent prompt from starting a second turn in the gap.
 */
export function hasPendingDelivery(sessionId: string): boolean {
  return getPendingTimers().has(sessionId);
}

/**
 * A user Stop: return anything already claimed for this session's pending
 * delivery to the queue and cancel the timer. The item keeps its head
 * position; nothing is sent until the next run end or explicit send.
 */
export function cancelQueuedDelivery(sessionId: string): void {
  clearPendingTimer(sessionId);
}

/** Forget a session's timer state (process teardown, session destroy). */
export function forgetQueuedDelivery(sessionId: string): void {
  clearPendingTimer(sessionId);
}
