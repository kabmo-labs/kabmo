/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * ONE background `/rename` request: its dispatch order, its claim on the frames
 * that answer it, and the barrier a following prompt waits on.
 *
 * Split from `auto-title.server.ts` because two callers share it — Kabmo's
 * auto-titling and the session row's "Rename with AI" — and because the three
 * rules below each fix a defect that made a rename silently not happen.
 *
 * ## 1. Claims are COUNTED, not a single slot
 *
 * A title request is answered by a `command_output` ("Session renamed to …" /
 * "Could not generate a session title"), which must stay out of the timeline.
 * The frame carries no correlation id, so attribution is by request. One slot
 * was enough while only one request could be outstanding; a settle attempt that
 * follows an early one re-arms the slot and the FIRST request's frame then
 * reaches the timeline as a notice row. Measured on a real session: the early
 * attempt answered 52 s in, after the run had already ended.
 *
 * ## 2. Dispatches are SERIALIZED on the host
 *
 * omp's `RpcUserInputGate` orders the operator's prompts, but Kabmo sends its
 * own `/rename` straight to the process — outside that gate. Two dispatches
 * therefore race their frames, and a request whose dispatch loses the race is
 * cancelled by omp (`renameTitle` reserves a title revision) without ever
 * emitting the `command_output` that would release its claim.
 *
 * ## 3. A prompt that follows a run end WAITS for the dispatch
 *
 * The requirement is that the rename a finished run asked for is ON THE WIRE
 * before the next prompt is. Both are separate frames on one stdin, so without
 * a barrier the operator's second prompt can be admitted first and the rename
 * then names a conversation that has already moved on. The wait is bounded and
 * cheap: the dispatch resolves on omp's ack (measured ~3 ms), never on the
 * generation.
 */

import { PROMPT_ACK_TIMEOUT_MS } from '@/server/lib/omp/rpc/constants';

/** omp's builtin that generates a title from the conversation. Sent with no
 *  args so omp derives it through its own `renameTitle`. */
export const GENERATE_TITLE_COMMAND = '/rename';

/**
 * How long a claim may suppress a `command_output`. Long enough for a title
 * generation (measured 4-52 s on a real child), short enough that a claim whose
 * request was cancelled cannot swallow an operator's own command output for
 * the rest of the session.
 */
export const TITLE_CLAIM_WINDOW_MS = 60_000;

/**
 * Ceiling on the barrier a prompt pays. The dispatch itself is an ack round
 * trip (~3 ms); this only bounds a child that stopped answering, so a wedged
 * rename can never hold the operator's next prompt.
 */
export const TITLE_DISPATCH_BARRIER_MS = 10_000;

/** How long the session-model pin is held for a request whose outcome never
 *  arrives (a cancelled generation emits no frame). */
export const TITLE_OUTCOME_HOLD_MS = 65_000;

/** Host surface a title request needs. Owned by the session wrapper. */
export interface TitleRequestHost {
  sessionId: string;
  /** Epoch ms until which claims may suppress a `command_output`; 0 when no
   *  claim is outstanding. */
  autoTitleWindowUntil: number;
  /** Outstanding requests, one claim each. */
  autoTitleClaims: number;
  /** In-flight DISPATCH (not generation), or null when the wire is idle. */
  autoTitleDispatch: Promise<void> | null;
  proc: {
    sendCommand<T = unknown>(command: { type: string; [key: string]: unknown }, timeoutMs?: number): Promise<T>;
  };
}

/** Resolvers waiting for a claim to be consumed, keyed by the host so a
 *  re-evaluated module cannot leak them into another wrapper. */
const outcomeWaiters = new WeakMap<object, Set<() => void>>();

function notifyClaimChanged(host: TitleRequestHost): void {
  const listeners = outcomeWaiters.get(host);
  if (!listeners) return;
  for (const listener of [...listeners]) listener();
}

/**
 * Claim the frames this request is about to produce.
 *
 * Called BEFORE the send, never after its ack: omp answers the prompt within
 * the same tick (measured ~3 ms), so a claim armed on the ack can already be
 * too late for the frame it was meant to cover.
 */
export function markTitleRequestSent(host: TitleRequestHost): void {
  host.autoTitleClaims += 1;
  host.autoTitleWindowUntil = Date.now() + TITLE_CLAIM_WINDOW_MS;
}

/** Drop one claim (a request that never reached omp, or one whose frame
 *  arrived). */
export function releaseTitleClaim(host: TitleRequestHost): void {
  if (host.autoTitleClaims > 0) host.autoTitleClaims -= 1;
  if (host.autoTitleClaims === 0) host.autoTitleWindowUntil = 0;
  notifyClaimChanged(host);
}

/**
 * True when this frame answers a title request and must stay out of the
 * timeline, consuming its claim. One frame per claim; a second `command_output`
 * inside the window belongs to something the operator typed.
 */
export function consumeAutoTitleOutput(host: TitleRequestHost): boolean {
  if (host.autoTitleClaims <= 0) return false;
  if (host.autoTitleWindowUntil !== 0 && Date.now() > host.autoTitleWindowUntil) {
    // The claim outlived its window: the request was cancelled or never
    // answered, and an operator's own output must not be swallowed by it.
    host.autoTitleClaims = 0;
    host.autoTitleWindowUntil = 0;
    notifyClaimChanged(host);
    return false;
  }
  releaseTitleClaim(host);
  return true;
}

/**
 * Send `/rename`, ordered behind any dispatch already in flight.
 *
 * `after` is the slot to queue behind, and it must be captured BEFORE the
 * caller claims the slot for itself — passing the host's current slot from
 * inside a run that already owns it would make the promise wait on itself.
 *
 * Resolves on omp's ack — the generation continues on its own and is reported
 * by the frames the claim covers.
 */
export function sendTitleRequest(
  host: TitleRequestHost,
  message: string = GENERATE_TITLE_COMMAND,
  after: Promise<void> | null = host.autoTitleDispatch,
): Promise<void> {
  // The slot is owned by the CALLER (`triggerAutoSessionTitle` /
  // `awaitTitleFrame`), which claims it synchronously so a prompt sent in the
  // same tick is ordered behind the whole request, not just its dispatch. This
  // function only queues behind what was already there.
  return (after ?? Promise.resolve()).then(async () => {
    markTitleRequestSent(host);
    try {
      await host.proc.sendCommand({ type: 'prompt', message }, PROMPT_ACK_TIMEOUT_MS);
    } catch (error) {
      // A request that never reached omp can never be answered, so its claim
      // would sit on the window and swallow the next real command output.
      releaseTitleClaim(host);
      throw error;
    }
  });
}

/**
 * Wait for the dispatch already in flight, bounded. A prompt that follows a run
 * end calls this so the rename the run asked for is written to the child's
 * stdin first (see rule 3 in the module doc).
 */
export async function awaitTitleDispatch(host: { autoTitleDispatch?: Promise<void> | null }): Promise<void> {
  const pending = host.autoTitleDispatch;
  if (!pending) return;
  const { promise, resolve } = Promise.withResolvers<void>();
  const timer = setTimeout(resolve, TITLE_DISPATCH_BARRIER_MS);
  timer.unref?.();
  try {
    await Promise.race([pending, promise]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Wait until the claims outstanding at call time have been consumed (or the
 * deadline passes).
 *
 * This is what keeps the session-model pin in place for the whole request: omp
 * resolves the title role when the generation STARTS and again for the card
 * request that follows a successful title, so releasing the pin on the ack
 * would name the session with the configured role — the exact failure the pin
 * exists to avoid.
 */
export function waitForTitleOutcome(host: TitleRequestHost, timeoutMs = TITLE_OUTCOME_HOLD_MS): Promise<void> {
  const start = host.autoTitleClaims;
  if (start <= 0) return Promise.resolve();
  const { promise, resolve } = Promise.withResolvers<void>();
  const listeners = outcomeWaiters.get(host) ?? new Set<() => void>();
  outcomeWaiters.set(host, listeners);
  let settled = false;
  const finish = () => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    listeners.delete(check);
    if (listeners.size === 0 && outcomeWaiters.get(host) === listeners) outcomeWaiters.delete(host);
    resolve();
  };
  const check = () => {
    if (host.autoTitleClaims < start) finish();
  };
  listeners.add(check);
  const timer = setTimeout(finish, timeoutMs);
  timer.unref?.();
  return promise;
}
