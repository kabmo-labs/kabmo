/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * What an inbound frame does BEFORE it is routed.
 *
 * Three jobs, all of them about the moment a frame arrives rather than what it
 * means:
 *
 *  - **Admission.** A frame that arrives while the handshake is open cannot be
 *    addressed (the session id is not known yet), so it is held and replayed in
 *    arrival order instead of dropped.
 *  - **Addressing.** Which sessions this client serves: itself, and the children
 *    it announced. A child's `fs/*` call is confined to the child's own cwd.
 *  - **Child cards.** The subagents RFD lets a parent announce a child whose
 *    work outlives the parent turn, so its card is emitted from here rather than
 *    from the turn machine — which resets every turn.
 *
 * Split out of `session.ts` for the per-file ceiling, and because these rules
 * are about the transport boundary, not about the chat.
 */

import { subagentCardStatus, type AcpSubagentRecord, type AcpSubagents, type SubagentCardStatus } from '@/server/lib/harness/acp/subagents';
import { subagentFrames } from '@/server/lib/harness/acp/subagent-frames';
import type { AgentEvent } from '@/server/lib/omp/rpc/constants';

/** How many setup-time frames may be held. A burst larger than this is a
 *  misbehaving adapter, and the notice says the tail was dropped. */
export const MAX_STAGED_FRAMES = 2_000;

/** One held frame, exactly as the process delivered it. */
export interface StagedFrame {
  method: string;
  params: Record<string, unknown>;
}

export interface AcpInboundOptions {
  readonly subagents: AcpSubagents;
  emit(event: AgentEvent): void;
  /** A restore owns its own frames: staging them would leave its buffer empty. */
  replaying(): boolean;
}

export class AcpInbound {
  private staged: StagedFrame[] | null = null;
  private truncated = false;
  private statuses: Map<string, SubagentCardStatus | null> | null = null;

  constructor(private readonly options: AcpInboundOptions) {}

  /** Open the hold. Called before the handshake, closed by `flush`. */
  begin(): void {
    this.staged = [];
  }

  /** Run the setup with the hold open, then route what it held. The restore's
   *  replay is excluded inside `shouldStage`, so its frames still reach the
   *  mapper while the handshake is open. */
  async run<T>(handshake: () => Promise<T>, route: (method: string, params: Record<string, unknown>) => void): Promise<T> {
    this.begin();
    try {
      return await handshake();
    } finally {
      this.flushInto(route);
    }
  }

  /** Route an arriving frame, holding it while the handshake is open. */
  admit(method: string, params: Record<string, unknown>, route: (method: string, params: Record<string, unknown>) => void): void {
    if (this.shouldStage()) {
      this.stage({ method, params });
      return;
    }
    route(method, params);
  }

  /** Whether a frame must be held instead of routed. */
  shouldStage(): boolean {
    return this.staged !== null && !this.options.replaying();
  }

  stage(frame: StagedFrame): void {
    if (!this.staged) return;
    if (this.staged.length >= MAX_STAGED_FRAMES) {
      this.truncated = true;
      return;
    }
    this.staged.push(frame);
  }

  /** Hand every held frame back, in arrival order, and say if the tail was cut. */
  flushInto(route: (method: string, params: Record<string, unknown>) => void): void {
    const frames = this.staged ?? [];
    this.staged = null;
    for (const frame of frames) route(frame.method, frame.params);
    if (!this.truncated) return;
    this.truncated = false;
    this.options.emit({
      type: 'notice',
      level: 'warning',
      message: `The agent sent more than ${MAX_STAGED_FRAMES} frames before its setup answer; the rest were dropped.`,
    });
  }

  /** Emit the card frames for one child record. A finished card is terminal:
   *  late traffic for a dead child must not reopen it. */
  emitSubagent(record: AcpSubagentRecord): void {
    const statuses = this.statuses ??= new Map();
    const previous = statuses.get(record.sessionId) ?? null;
    const status = subagentCardStatus(record);
    // A finished card is terminal for late traffic — but a child that the agent
    // RESUMES (`running` after `idle`) is real work and reopens it. Comparing
    // the status, not the frame, keeps a late chunk from waking a dead card.
    if (previous !== null && previous !== 'running' && status !== 'running') return;
    statuses.set(record.sessionId, status);
    for (const event of subagentFrames(record, previous)) this.options.emit(event);
  }

  /** Close every child card when the parent goes away. */
  closeSubagents(): void {
    for (const record of this.options.subagents.finishAll()) this.emitSubagent(record);
  }

}
