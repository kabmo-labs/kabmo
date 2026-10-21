/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * When is the session a prompt is waiting for actually finished?
 *
 * "The stream row says `finish`" is not the answer on its own, and each of the
 * other conditions below is a measured failure of trusting it alone:
 *
 *   - **A live wrapper can still be busy.** `agent_end` is written before the
 *     turn's bookkeeping settles, and a compaction, a subagent or an open ask
 *     dialog keeps `isBusy()` true with no `stream` row to say so. A prompt sent
 *     into that state is refused by omp mid-turn and dropped.
 *   - **A queued follow-up is about to be delivered.** The run end arms the
 *     queue 500 ms out, so `finish` followed by a claim is the normal sequence
 *     for a session the user kept typing into. Waiting on `hasQueuedItem` alone
 *     still races the window between the claim and the prompt.
 *   - **A pending delivery timer is the same fact, one step earlier.**
 *   - **The row's clock is coarse.** `CURRENT_TIMESTAMP` has one-second
 *     resolution, so a `finish` written this second may be a row an `agent_start`
 *     is about to overwrite. A grace window on top of it closes the gap.
 *
 * The check is deliberately conservative: a dependency that is not yet provably
 * finished is simply re-checked on the next sweep. Nothing is lost by waiting a
 * second longer, and a prompt delivered into a running turn is lost entirely.
 */

import type { SessionStreamStatus } from '@/shared/lib/omp/session/stream-state.server';

/** Slack applied after a dependency's last stream write, in ms. */
export const SETTLE_GRACE_MS = 1_500;

/** Everything the check reads, injected so a test needs no database or child. */
export interface DependencyState {
  /** The dependency's stream row, or undefined when it has none. */
  stream: { status: SessionStreamStatus; updatedAt?: number | null } | undefined;
  /** Epoch ms the row was last written, or null when the caller cannot tell. */
  rowWrittenAt?: number | null;
  /** Whether a live wrapper for it is still working (dialog, subagent, turn). */
  busy: boolean;
  /** Whether its follow-up queue still holds an item. */
  queued: boolean;
  /** Whether this process has a delivery slot armed for it. */
  delivering: boolean;
}

export interface DependencyVerdict {
  settled: boolean;
  /** Why it is not settled yet — shown nowhere, logged and asserted in tests. */
  reason: 'no-row' | 'streaming' | 'busy' | 'queued' | 'delivering' | 'grace' | null;
}

/**
 * Whether a dependency has provably finished: no run, no queue, no delivery in
 * flight, and its last status write is older than the grace window.
 */
export function dependencyVerdict(state: DependencyState, now = Date.now()): DependencyVerdict {
  const status = state.stream?.status;
  if (status === 'stream') return { settled: false, reason: 'streaming' };
  // No row at all is a session Kabmo has never seen run — an id typed by hand,
  // or one whose row the heal pass released. Nothing can be waited on, so it
  // counts as finished rather than blocking the prompt forever.
  if (state.stream === undefined) return { settled: true, reason: 'no-row' };
  if (state.busy) return { settled: false, reason: 'busy' };
  if (state.queued) return { settled: false, reason: 'queued' };
  if (state.delivering) return { settled: false, reason: 'delivering' };
  // The grace is about ORDER, not about the row's own fields: a run end writes
  // `finish` and arms the follow-up queue 500 ms later, so a caller supplies the
  // write's clock separately (see `streamRowWrittenAt`).
  const writtenAt = state.rowWrittenAt ?? state.stream.updatedAt;
  if (typeof writtenAt === 'number' && now - writtenAt < SETTLE_GRACE_MS) {
    return { settled: false, reason: 'grace' };
  }
  return { settled: true, reason: null };
}
