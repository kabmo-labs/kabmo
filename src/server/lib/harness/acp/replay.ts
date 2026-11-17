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
 * The buffer is taken ONCE, by the restore that asked for it. The window closes
 * on `idle`, or after a bounded wait: a peer that never sends an idle must not
 * hold the restore open forever.
 */

import { AcpFrameMapper } from '@/server/lib/harness/acp/frames';
import type { AgentEvent } from '@/server/lib/omp/rpc/constants';

const REPLAY_SETTLE_MS = 1_500;

export class AcpReplay {
  private buffer: AgentEvent[] | null = null;
  private active = false;
  private settled: (() => void) | null = null;

  /** True while frames belong to a replay instead of a turn. */
  get isActive(): boolean {
    return this.active;
  }

  /** Run the handshake with the replay window open, then close it. */
  async run<T>(mapper: AcpFrameMapper, handshake: () => Promise<T>): Promise<T> {
    this.buffer = [];
    this.active = true;
    mapper.setReplaying(true);
    const settled = new Promise<void>((resolve) => { this.settled = resolve; });
    try {
      const result = await handshake();
      await Promise.race([settled, new Promise<void>((resolve) => setTimeout(resolve, REPLAY_SETTLE_MS))]);
      return result;
    } finally {
      this.close(mapper);
    }
  }

  /** Buffer one frame while the window is open; no-op otherwise. */
  push(event: AgentEvent): void {
    if (this.active && this.buffer) this.buffer.push(event);
  }

  /** `state_update: idle` is the adapter's own end marker for the replay. */
  markIdle(state: unknown): void {
    if (this.active && state === 'idle') this.settled?.();
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
