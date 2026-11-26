/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The window a restore replays history in.
 *
 * ACP v2 `session/resume` with `replayFrom: { type: 'start' }` sends the whole
 * retained transcript as ordinary `session/update` frames BEFORE it answers.
 * The session has no active turn then, and two gates would drop those frames:
 * the turn gate (nothing is being accepted) and the mapper's rule that a user
 * chunk is a receipt for a bubble the composer already drew. This object owns
 * the first gate and the frame buffer, so the session class keeps its own
 * concerns and the rules are testable without a child.
 *
 * The window closes on the adapter's own `replay_complete` marker, on an idle
 * `state_update` (v1's only end signal), or after a bounded wait for a peer that
 * sends neither. The fallback used to be 1.5 s — shorter than a large
 * transcript takes to stream, so the tail of a restore was silently dropped.
 * The buffer is capped for the mirror reason: a replay is the one place a
 * single turn can carry an unbounded number of frames.
 */

import { AcpFrameMapper } from '@kabmo-labs/kabmo-acp-mapper/frames';
import type { AgentEvent } from '@/server/lib/omp/rpc/constants';

/** How long to wait for a marker when the adapter sends none. Large replays
 *  stream for seconds; this bounds a peer that never marks the end at all. */
export const REPLAY_FALLBACK_MS = 15_000;
/** Frames one replay may hold. Beyond this the restore is truncated rather
 *  than allowed to grow without bound. */
export const MAX_REPLAY_EVENTS = 20_000;

export class AcpReplay {
  private buffer: AgentEvent[] | null = null;
  private active = false;
  private truncated = false;
  private settled: (() => void) | null = null;

  /** True while frames belong to a replay instead of a turn. */
  get isActive(): boolean {
    return this.active;
  }

  /** True when the replay hit the frame cap; the tail was not kept. */
  get isTruncated(): boolean {
    return this.truncated;
  }

  /** Run the handshake with the replay window open, then close it. */
  async run<T>(mapper: AcpFrameMapper, handshake: () => Promise<T>): Promise<T> {
    this.buffer = [];
    this.truncated = false;
    this.active = true;
    mapper.setReplaying(true);
    const settled = new Promise<void>((resolve) => { this.settled = resolve; });
    try {
      const result = await handshake();
      await Promise.race([settled, new Promise<void>((resolve) => setTimeout(resolve, REPLAY_FALLBACK_MS))]);
      return result;
    } finally {
      this.close(mapper);
    }
  }

  /** Buffer one frame while the window is open; no-op otherwise. */
  push(event: AgentEvent): void {
    if (!this.active || !this.buffer) return;
    if (this.buffer.length >= MAX_REPLAY_EVENTS) {
      this.truncated = true;
      return;
    }
    this.buffer.push(event);
  }

  /** The adapter's explicit end marker, or an idle state. Idempotent. */
  markSettled(): void {
    if (this.active) this.settled?.();
  }

  /** `state_update: idle` is the older adapters' end marker for the replay. */
  markIdle(state: unknown): void {
    if (state === 'idle') this.markSettled();
  }

  /** The frames replayed, and only once. The window is already closed by the
   *  handshake's `finally`; taking also closes it so a caller that never ran
   *  the handshake cannot leave the gate open. */
  take(): AgentEvent[] {
    this.active = false;
    this.settled = null;
    const events = this.buffer ?? [];
    this.buffer = null;
    return events;
  }

  private close(mapper: AcpFrameMapper): void {
    this.active = false;
    this.settled = null;
    mapper.setReplaying(false);
  }
}
