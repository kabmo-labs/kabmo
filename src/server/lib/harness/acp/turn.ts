/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The life of an ACP turn: one prompt, its frames, and how it ends.
 *
 * Three rules, each a bug that had to be learned:
 *
 *  - **a prompt is CHAINED, never raced.** ACP has no queue: a second
 *    `session/prompt` while one is open CANCELS the first (measured, twice).
 *  - **a cancelled turn is closed HERE**, not by waiting for the agent.
 *    `session/cancel` is a notification and the answer is not guaranteed.
 *  - **frames are accepted only while a turn is open**, so abandoned output
 *    cannot reach a client that already finalized the message.
 */

import type { AgentEvent } from '@/server/lib/omp/rpc/constants';
import { AcpRequestError } from '@/server/lib/harness/acp/calls';
import { turnEndFrame } from '@/server/lib/harness/acp/frames';
import { TurnSilence } from '@/server/lib/harness/acp/turn-silence';
import { CancelSettle } from '@/server/lib/harness/acp/turn-cancel';
import { TurnQueue } from '@/server/lib/harness/acp/turn-queue';
import { promptWithBusyRetry, SESSION_BUSY_WAIT_MS } from '@/server/lib/harness/acp/turn-dispatch';
import { reasonSuppressed, turnVerdict } from '@/server/lib/harness/acp/turn-verdict';

const STRANDED_REASON = 'The agent stopped reporting progress; the turn was closed after a long silence.';

/** What a closed turn reports to its session and the parent notice. */
export interface AcpTurnEndInfo {
  stopReason?: string;
  closedMessage: boolean;
  message?: unknown;
  cancelled?: boolean;
  failed?: boolean;
  failure?: string | null;
  /** Closed by the silence ceiling, not by the agent. */
  stranded?: boolean;
}

export interface AcpTurnSeams {
  /** Push one frame at the session's listeners. */
  emit: (event: AgentEvent) => void;
  /** Send `session/prompt` and resolve when the AGENT ends the turn. */
  prompt: (message: string, images: unknown) => Promise<{ stopReason?: string } | undefined>;
  /** Send `session/cancel` — a notification the agent may never answer. */
  cancelAgent: () => void;
  /** Settle the outstanding request locally, as cancelled. */
  abandonPrompt: () => void;
  /** Start a clean mapper, so the previous turn cannot leak into this one. */
  resetMapper: () => void;
  /** Flush the message the turn left open. */
  closeMessage: () => AgentEvent[];
  /** Tool calls the turn abandoned, by id. */
  openCalls: () => string[];
  /**
   * The turn is over (finished, failed or cancelled), with the agent's own stop
   * reason, the assistant message the mapper closed (the goal driver audits it),
   * and whether the turn was cancelled (a stop must not be audited).
   */
  onTurnEnd: (info: AcpTurnEndInfo) => void;
}

export class AcpTurns {
  isStreaming = false;
  isPromptRunning = false;
  /**
   * How a turn ENDS. v1: the `session/prompt` response carries `stopReason`.
   * v2: the response acknowledges insertion; an idle `state_update` ends the
   * turn, so the prompt's resolution only clears the acceptance request.
   */
  completion: 'response' | 'state' = 'response';
  /** The turn whose frames are accepted, null when none is open. */
  private open: number | null = null;
  /** Identity of the last turn started; only ever grows, so a late reply can be
   *  matched to the turn that produced it. */
  private seq = 0;
  /** The outstanding `session/prompt` request — the chain the next turn waits on. */
  private request: Promise<unknown> | null = null;
  /** The prompt text of the turn being opened, for the silent-turn verdict. */
  private promptText = '';
  /** Set by a local cancel: non-idle states are the cancelled run, not new work. */
  private awaitingCancellation = false;
  /** The silence ceiling for the open turn — see `turn-silence.ts`. */
  readonly #silence: TurnSilence;
  /** Settles the prompt after a cancel the agent never answered. */
  readonly #cancelSettle: CancelSettle;
  /** Inputs held for an agent with no mid-turn channel. */
  readonly #queue = new TurnQueue();
  readonly #busyWaitMs: number;

  constructor(private readonly seams: AcpTurnSeams, options: { silenceMs?: number; busyWaitMs?: number } = {}) {
    this.#silence = new TurnSilence(() => this.strand(), options.silenceMs);
    this.#cancelSettle = new CancelSettle(() => this.seams.abandonPrompt());
    this.#busyWaitMs = options.busyWaitMs ?? SESSION_BUSY_WAIT_MS;
  }

  /** Any frame from the agent defers the silence ceiling. */
  noteActivity(): void {
    if (this.open !== null) this.#silence.arm();
  }

  /**
   * Close a turn the agent stopped reporting on. Public so a caller that has
   * its own evidence (a probe, a shutdown) can settle it the same way.
   */
  strand(): void {
    if (this.open === null) return;
    const turnId = this.open;
    this.settle(turnId, () => this.finish(undefined, false, STRANDED_REASON, true));
  }

  /** The same field omp puts on its ack, so a client that inspects it reads one
   *  vocabulary whichever transport served the chat. */
  start(message: string, images: unknown): { agentInvoked: true } {
    if (this.isPromptRunning || this.isStreaming) {
      throw new Error('Agent is already processing. Use steer() or followUp() to queue messages, or wait for completion.');
    }
    this.seq += 1;
    const turnId = this.seq;
    // A new prompt IS the decision that a cancelled turn is over: free the chain
    // now rather than waiting out the grace window.
    this.#cancelSettle.flush();
    this.promptText = message;
    this.awaitingCancellation = false;
    this.isPromptRunning = true;
    this.isStreaming = true;
    this.#silence.arm();
    this.seams.emit({ type: 'agent_start' });
    this.seams.emit({ type: 'turn_start' });

    const request = (this.request ?? Promise.resolve())
      .catch(() => undefined)
      .then(() => {
        // Stop pressed while this turn queued behind the previous prompt: the
        // flags were cleared, so the prompt must never reach the agent.
        if (!this.isPromptRunning || !this.isStreaming) return undefined;
        this.open = turnId;
        this.seams.resetMapper();
        // `-32003 session_busy` is the agent still finishing its previous turn,
        // not a failure: wait for it instead of reporting an error the operator
        // can only work around by waiting.
        return promptWithBusyRetry(() => this.seams.prompt(message, images), {
          waitMs: this.#busyWaitMs,
          isActive: () => this.open === turnId && this.isPromptRunning,
        });
      });
    this.request = request;
    void request
      .then(
        (result) => {
          // v2: acceptance is not completion. The idle `state_update` closes it.
          if (this.completion === 'state') return;
          this.settle(turnId, () => this.finish(result as { stopReason?: string } | undefined));
        },
        (error: unknown) =>
          this.settle(turnId, () => {
            // `-32800` is ACP's "Request cancelled": an agent that aborted the
            // turn itself (context limit, internal timeout) answered with this
            // instead of a stop reason. It is not a failure to show the user.
            if (error instanceof AcpRequestError && error.code === -32800) {
              this.finish({ stopReason: 'cancelled' });
              return;
            }
            const message = error instanceof Error ? error.message : String(error);
            this.seams.emit({ type: 'prompt_error', errorMessage: message });
            // The agent's own error is the reason. `finish` must not append its
            // generic "no answer" verdict on top of it — the second frame lands
            // last on the client and replaced the useful message.
            this.finish(undefined, true, message);
          }),
      )
      .finally(() => {
        if (this.request === request) this.request = null;
      });

    return { agentInvoked: true };
  }

  /** Stop the turn AND close it here.
   *
   *  Nothing guarantees the agent answers the cancel, and a session whose agent
   *  never does stays `isStreaming` forever — the NEXT prompt is refused as
   *  "already processing". The outstanding prompt is settled after a grace
   *  window for the same reason: it is what the next turn is chained behind. */
  cancel(): void {
    this.awaitingCancellation = true;
    this.#cancelSettle.disarm();
    if (this.open === null) {
      // The prompt is still queued behind the previous request (or was never
      // dispatched): clear the flags or Stop leaves the session permanently
      // "processing", and tell the agent anyway — a cancel with nothing to stop
      // is a no-op, while a prompt that slips out afterwards is what hangs the
      // NEXT send.
      if (this.isPromptRunning || this.isStreaming) {
        this.abandonOnStop();
        this.finish({ stopReason: 'cancelled' });
      }
      this.isPromptRunning = false;
      this.isStreaming = false;
      this.#silence.stop();
      return;
    }
    this.open = null;
    this.#silence.stop();
    this.seams.cancelAgent();
    this.finish({ stopReason: 'cancelled' });
    // A held input is the operator's NEXT intent and must not wait out the
    // grace window; otherwise let the agent end its own turn first.
    if (this.#queue.size > 0) this.seams.abandonPrompt();
    else this.#cancelSettle.arm();
  }

  /** Hold an input until the running turn ends. */
  queue(message: string, images: unknown): void {
    this.#queue.push({ message, images });
  }

  /** Take the next held input; the SESSION dispatches it, so counters and the
   *  run marker stay on its own path. */
  takeQueued(): { message: string; images: unknown } | undefined {
    return this.#queue.shift();
  }

  /** The grace window is still open: a Stop that has not been answered yet. */
  pendingCancel(): boolean {
    return this.#cancelSettle.pending();
  }

  /** The prompt that a Stop must free, dispatched or still queued. */
  private abandonOnStop(): void {
    this.seams.cancelAgent();
    this.seams.abandonPrompt();
  }

  /** Is a turn accepting the agent's frames right now? */
  acceptingFrames(): boolean {
    return this.open !== null;
  }

  /** v2's turn boundary: an idle `state_update` ends foreground work.
   *
   *  `running`/`requires_action` do not open a turn when a prompt is still being
   *  inserted; agent-initiated work with no prompt does. Repeats are idempotent
   *  because `settle` matches the turn id. */
  onStateUpdate(update: Record<string, unknown>): void {
    if (this.completion !== 'state') return;
    const state = typeof update.state === 'string' ? update.state : '';
    if (state !== 'idle') {
      // A cancelled run's running/requires_action is not a new interval;
      // foreground work with no prompt (a goal) does open one.
      if (this.awaitingCancellation) return;
      if (this.open === null && !this.isPromptRunning && !this.isStreaming) this.beginAgentTurn();
      return;
    }
    this.awaitingCancellation = false;
    if (this.open === null) return;
    const turnId = this.open;
    this.settle(turnId, () => {
      const error = update.error && typeof update.error === 'object'
        ? (update.error as Record<string, unknown>)
        : undefined;
      const failure = typeof error?.message === 'string' ? error.message : undefined;
      const stopReason = typeof update.stopReason === 'string' ? update.stopReason : undefined;
      if (stopReason === 'error') {
        this.seams.emit({
          type: 'prompt_error',
          errorMessage: failure ?? 'The agent ended the turn with an error',
        });
        this.finish({ stopReason: 'error' }, true, failure);
        return;
      }
      this.finish(stopReason ? { stopReason } : undefined);
    });
  }

  /** A v2 foreground interval that no `session/prompt` started. */
  private beginAgentTurn(): void {
    this.seq += 1;
    this.open = this.seq;
    this.promptText = '';
    this.isPromptRunning = true;
    this.isStreaming = true;
    this.#silence.arm();
    this.seams.resetMapper();
    this.seams.emit({ type: 'agent_start' });
    this.seams.emit({ type: 'turn_start' });
  }

  /** Close a turn, unless it was cancelled first: a cancelled turn's late reply
   *  must not close the one the user is now watching. */
  private settle(turnId: number, close: () => void): void {
    if (this.open !== turnId) return;
    this.open = null;
    close();
  }

  /** Flush the open message, fail abandoned cards, emit the terminal frame. A
   *  call left open by a cancelled turn would spin forever — the agent is never
   *  going to report an end for work it abandoned. `reported` says the caller
   *  already emitted the failure reason, so only this module's generic silent
   *  verdict is suppressed. */
  private finish(
    result: { stopReason?: string } | undefined,
    reported = false,
    failure?: string,
    stranded = false,
  ): void {
    this.#silence.stop();
    const flushed = this.seams.closeMessage();
    for (const event of flushed) this.seams.emit(event);
    const closed = flushed.find((event) => event.type === 'message_end')?.message;
    const abandoned = this.seams.openCalls();
    for (const toolCallId of abandoned) {
      this.seams.emit({ type: 'tool_execution_end', toolCallId, isError: true, result: { output: 'Cancelled' } });
    }
    const { failed, cancelled, reason } = turnVerdict({
      closed,
      abandoned: abandoned.length,
      result,
      reported,
      stranded,
      promptText: this.promptText,
      completion: this.completion,
      strandedReason: STRANDED_REASON,
      ...(failure ? { failure } : {}),
    });
    if (failed && !reported && !reasonSuppressed(this.promptText)) {
      this.seams.emit({
        type: 'prompt_error',
        errorMessage: reason ?? 'The agent ended the turn without sending an answer',
      });
    }
    this.isPromptRunning = false;
    this.isStreaming = false;
    this.seams.emit(turnEndFrame(result));
    this.seams.onTurnEnd({
      ...(result?.stopReason ? { stopReason: result.stopReason } : {}),
      closedMessage: flushed.some((event) => event.type === 'message_end'),
      ...(closed ? { message: closed } : {}),
      ...(cancelled ? { cancelled: true } : {}),
      ...(stranded ? { stranded: true } : {}),
      ...(failed ? { failed: true, failure: reason } : {}),
    });
  }
}
