/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The life of an ACP turn: one prompt, its frames, and how it ends.
 *
 * Split out of `AcpSession` because the rules here are the ones that took a bug
 * each to learn, and a session that also owns spawning, config selectors and
 * client requests buried them:
 *
 *  - **a prompt is CHAINED, never raced.** ACP has no queue: a second
 *    `session/prompt` while one is open CANCELS the first (measured, twice).
 *  - **a cancelled turn is closed HERE**, not by waiting for the agent.
 *    `session/cancel` is a notification and the answer is not guaranteed.
 *  - **frames are accepted only while a turn is open**, so abandoned output
 *    cannot reach a client that already finalized the message.
 */

import type { AgentEvent } from '@/server/lib/omp/rpc/constants';
import { turnEndFrame } from '@/server/lib/harness/acp/frames';

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
  onTurnEnd: (info: { stopReason?: string; closedMessage: boolean; message?: unknown; cancelled?: boolean }) => void;
}

export class AcpTurns {
  isStreaming = false;
  isPromptRunning = false;
  /** The turn whose frames are accepted, null when none is open. */
  private open: number | null = null;
  /** Identity of the last turn started; only ever grows, so a late reply can be
   *  matched to the turn that produced it. */
  private seq = 0;
  /** The outstanding `session/prompt` request — the chain the next turn waits on. */
  private request: Promise<unknown> | null = null;
  /** The prompt text of the turn being opened, for the silent-turn verdict. */
  private promptText = '';

  constructor(private readonly seams: AcpTurnSeams) {}

  /** The same field omp puts on its ack, so a client that inspects it reads one
   *  vocabulary whichever transport served the chat. */
  start(message: string, images: unknown): { agentInvoked: true } {
    if (this.isPromptRunning || this.isStreaming) {
      throw new Error('Agent is already processing. Use steer() or followUp() to queue messages, or wait for completion.');
    }
    this.seq += 1;
    const turnId = this.seq;
    this.promptText = message;
    this.isPromptRunning = true;
    this.isStreaming = true;
    this.seams.emit({ type: 'agent_start' });
    this.seams.emit({ type: 'turn_start' });

    const request = (this.request ?? Promise.resolve())
      .catch(() => undefined)
      .then(() => {
        this.open = turnId;
        this.seams.resetMapper();
        return this.seams.prompt(message, images);
      });
    this.request = request;
    void request
      .then(
        (result) => this.settle(turnId, () => this.finish(result)),
        (error: unknown) =>
          this.settle(turnId, () => {
            this.seams.emit({
              type: 'prompt_error',
              errorMessage: error instanceof Error ? error.message : String(error),
            });
            // The agent's own error is the reason. `finish` must not append its
            // generic "no answer" verdict on top of it — the second frame lands
            // last on the client and replaced the useful message.
            this.finish(undefined, true);
          }),
      )
      .finally(() => {
        if (this.request === request) this.request = null;
      });

    return { agentInvoked: true };
  }

  /**
   * Stop the turn AND close it here.
   *
   * Nothing guarantees the agent answers the cancel, and a session whose agent
   * never does stayed `isStreaming` forever: the spinner cleared, and the NEXT
   * prompt was refused with "Agent is already processing". The agent's own
   * prompt request is settled locally for the same reason — it is what the next
   * turn is chained behind.
   */
  cancel(): void {
    if (this.open === null) {
      // Nothing dispatched yet, but a turn may be queued behind the previous
      // request: clear its flags too, or Stop leaves the session permanently
      // "processing".
      this.isPromptRunning = false;
      this.isStreaming = false;
      return;
    }
    this.open = null;
    this.seams.cancelAgent();
    this.seams.abandonPrompt();
    this.finish({ stopReason: 'cancelled' });
  }

  /** Is a turn accepting the agent's frames right now? */
  acceptingFrames(): boolean {
    return this.open !== null;
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
  private finish(result: { stopReason?: string } | undefined, reported = false): void {
    const flushed = this.seams.closeMessage();
    for (const event of flushed) this.seams.emit(event);
    const closed = flushed.find((event) => event.type === 'message_end')?.message;
    const abandoned = this.seams.openCalls();
    for (const toolCallId of abandoned) {
      this.seams.emit({ type: 'tool_execution_end', toolCallId, isError: true, result: { output: 'Cancelled' } });
    }
    // A prompt that ends with no message and no tool call is a SILENT failure on
    // most agents (measured on pi-acp: it answers `session/prompt` with `{}` and
    // sends no frames at all when its provider call fails). Reporting it beats
    // leaving an empty bubble that reads as "the agent had nothing to say".
    // Whitespace-only chunks are the same failure with a frame attached: the
    // row renders no text, so the operator still sees nothing. Slash commands
    // are exempt: an extension command is answered locally and correctly
    // produces nothing, and a user's Stop is not a failure either.
    const answered = hasRenderableAnswer(closed) || abandoned.length > 0;
    const cancelled = result?.stopReason === 'cancelled';
    if (!answered && !cancelled && !reported && !this.promptText.trimStart().startsWith('/')) {
      this.seams.emit({
        type: 'prompt_error',
        errorMessage: 'The agent ended the turn without sending an answer',
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
    });
  }
}

/** Does the closed message carry anything the timeline draws? A whitespace-only
 *  chunk (or one that carried only an empty text block) opens a message row
 *  that renders nothing, which is the same operator-visible failure as no frame
 *  at all. Thinking and tool calls are content: they render as their own
 *  blocks. */
function hasRenderableAnswer(message: unknown): boolean {
  if (!message || typeof message !== 'object' || !('content' in message)) return false;
  const content = message.content;
  if (!Array.isArray(content)) return false;
  return content.some((block) => {
    if (!block || typeof block !== 'object') return false;
    if ('text' in block && typeof block.text === 'string') return block.text.trim().length > 0;
    if ('thinking' in block && typeof block.thinking === 'string') return block.thinking.trim().length > 0;
    return 'type' in block && block.type === 'toolCall';
  });
}
