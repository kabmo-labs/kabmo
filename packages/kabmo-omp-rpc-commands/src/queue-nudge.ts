/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * "A run boundary just happened — the queue may have work."
 *
 * The command layer reaches this after a prompt that never started a turn and
 * after a builtin that declined to run: both leave the session idle while the
 * follow-up queue may still hold the next message. Deciding WHETHER to deliver
 * belongs to the queue (it owns the timers, the claim and the stale window), so
 * the command layer raises the fact and the queue registers for it.
 *
 * A registered reporter rather than an import, for the reason the stream state
 * uses one: this module sits under the queue's own scheduler, and importing the
 * queue from a command dispatch would drag `queue/store`, the payload builder
 * and the waiting sweep into every RPC command.
 */

/**
 * The slice of a session a delivery needs. Structurally identical to the queue's
 * own `QueueDeliveryHost`, so the queue registers its scheduler directly with no
 * cast on either side.
 */
export interface QueueNudgeHost {
  sessionId: string;
  isAlive(): boolean;
  isBusy(): boolean;
  send(command: Record<string, unknown>): Promise<unknown>;
}

type QueueNudge = (session: QueueNudgeHost) => void;

declare global {
  // eslint-disable-next-line no-var
  var __kabmoQueueNudge: QueueNudge | undefined;
}

/**
 * Register the queue's scheduler. Lives on `globalThis` for the reason the
 * signal registry does: `bun --hot` re-evaluates this module while the queue's
 * one-shot registration does not re-run, and a module-level slot would leave the
 * new instance nudging nobody.
 */
export function registerQueueNudge(nudge: QueueNudge | null): void {
  globalThis.__kabmoQueueNudge = nudge ?? undefined;
}

/** Raise it. A missing registration means no delivery is scheduled — never a
 *  failed command, which is why this returns void and cannot throw. */
export function nudgeQueueDelivery(session: QueueNudgeHost): void {
  globalThis.__kabmoQueueNudge?.(session);
}
