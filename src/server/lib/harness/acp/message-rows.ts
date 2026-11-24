/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The row accumulator behind `AcpFrameMapper`: one ACP turn's blocks, cut into
 * the rows the timeline renders.
 *
 * Split out of `frames.ts` (which is the update dispatcher) because the row
 * boundary rules are a unit of their own, and the file ceiling is real.
 *
 * **A row never holds prose written after one of its cards.** The timeline
 * draws a row's blocks in a fixed order — thinking, then the answer text, then
 * the cards (`MessageItem`, because `parseMessageBlocks` collects them into
 * separate fields) — so a row holding both puts the card BELOW prose the agent
 * wrote after it. Measured on session `9ea5a178` (antigravity): the frames
 * arrived `tool_call run_command` → `tool_execution_end` →
 * `agent_thought_chunk` → `agent_message_chunk` "Ini gambarnya!…", the single
 * row held `[toolCall, thinking, text]` and rendered
 * `"Ini gambarnya!Run Command… Done"`; split at the boundary it renders
 * `"Run Command… DoneIni gambarnya!"`, which is arrival order. Consecutive
 * cards share a row and consecutive chunks share a row, so this is the same
 * segmentation omp emits (one `message_update` per segment).
 *
 * Rows are a DISPLAY split, so the turn is still one answer for the readers that
 * ask about the turn: `turnMessage()` accumulates every closed row.
 */

import type { AgentEvent } from '@/server/lib/omp/rpc/constants';
import type { ToolCallBlock } from '@/server/lib/harness/acp/tool-calls';

/** One block of the accumulated assistant message, in `parseMessageBlocks` shape. */
export type MessageBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string }
  | ToolCallBlock;

export class AcpMessageRows {
  private blocks: MessageBlock[] = [];
  /** Every block this turn already closed, in order. */
  private turnBlocks: MessageBlock[] = [];
  private messageId: string | null = null;
  /** Identity of the row being emitted. Distinct from `messageId`: a card and
   *  the prose after it are two rows of ONE ACP message, and reusing the id
   *  would make the client update the first row instead of appending the
   *  second. */
  private rowId: string | null = null;
  /** When the open row's first frame arrived, its timeline stamp. */
  private openedAt: number | null = null;
  /** When the turn was dispatched, the base for its duration. */
  private turnStartedAt: number | null = null;
  /** Content of the open ACP message already emitted in CLOSED rows, per kind.
   *  A v2 `agent_message` is an upsert of the whole content, so what a split
   *  already drew must be subtracted or the answer is duplicated. */
  private closedText = '';
  private closedThinking = '';

  /** Forget everything (an aborted run, a fresh turn) and start its clock. */
  reset(startedAt: number = Date.now()): void {
    this.blocks = [];
    this.turnBlocks = [];
    this.messageId = null;
    this.rowId = null;
    this.openedAt = null;
    this.turnStartedAt = startedAt;
    this.closedText = '';
    this.closedThinking = '';
  }

  /** The ACP `messageId` the open row belongs to; null when the agent omits it. */
  get acpMessageId(): string | null {
    return this.messageId;
  }

  setAcpMessageId(id: string | null): void {
    if (id !== this.messageId) {
      this.closedText = '';
      this.closedThinking = '';
    }
    this.messageId = id;
  }

  /** The open row's newest block is a card. */
  endsWithTool(): boolean {
    return this.blocks[this.blocks.length - 1]?.type === 'toolCall';
  }

  /** The open row's newest block is content, prose or thinking. */
  endsWithContent(): boolean {
    const last = this.blocks[this.blocks.length - 1];
    return last !== undefined && last.type !== 'toolCall';
  }

  push(block: MessageBlock): void {
    this.blocks.push(block);
  }

  /** Append one delta to the open row, merging runs of the same kind. */
  appendContent(kind: 'text' | 'thinking', text: string): void {
    const last = this.blocks[this.blocks.length - 1];
    if (kind === 'text') {
      if (last?.type === 'text') last.text += text;
      else this.blocks.push({ type: 'text', text });
      return;
    }
    if (last?.type === 'thinking') last.thinking += text;
    else this.blocks.push({ type: 'thinking', thinking: text });
  }

  /** Drop the open row's blocks of one kind (a v2 whole-message upsert). */
  replaceContent(kind: 'text' | 'thinking', text: string): void {
    this.blocks = this.blocks.filter((block) => block.type !== kind);
    if (text) this.appendContent(kind, text);
  }

  /**
   * The part of a v2 whole-message value this ACP message has not drawn yet.
   *
   * A split moves text into closed rows, but `agent_message` keeps sending the
   * message's FULL content; without this the answer would appear twice. Text
   * that does not extend what was drawn (a rewrite) is taken whole — the same
   * copy the row would have shown before the split existed.
   */
  contentDelta(kind: 'text' | 'thinking', full: string): string {
    const drawn = kind === 'text' ? this.closedText : this.closedThinking;
    return drawn && full.startsWith(drawn) ? full.slice(drawn.length) : full;
  }

  /**
   * The open row in omp's wire shape.
   *
   * `messageId` is OPTIONAL in ACP v1, and an agent that omits it (measured on
   * antigravity 1.5.3: every chunk carried only `sessionUpdate` + `content`)
   * still needs one identity per row. Without it, `toChatMessage` minted
   * `msg-<Date.now()>-ai` per frame, so every chunk after the first APPENDED a
   * new row instead of updating the streaming one — the turn showed as
   * duplicate bubbles and the final answer again at `message_end`.
   */
  snapshot(): Record<string, unknown> {
    const id = this.rowId ??= `acp-${crypto.randomUUID()}`;
    const timestamp = this.openedAt ??= Date.now();
    return {
      role: 'assistant',
      id,
      timestamp,
      content: this.blocks.map((block) => ({ ...block })),
    };
  }

  /**
   * Close the open row, as `message_end` frames (empty when there is none).
   *
   * `messageId` SURVIVES the close: the rest of the same ACP message continues
   * the next row, which is exactly what the boundary exists for. `reset()` is
   * what forgets the message.
   */
  close(): AgentEvent[] {
    if (this.blocks.length === 0) return [];
    const completedAt = Date.now();
    const message = this.snapshot();
    const startedAt = this.turnStartedAt ?? this.openedAt;
    if (startedAt !== null) {
      message.completedAt = completedAt;
      message.duration = Math.max(0, completedAt - startedAt);
    }
    this.turnBlocks.push(...this.blocks.map((block) => ({ ...block })));
    for (const block of this.blocks) {
      if (block.type === 'text') this.closedText += block.text;
      else if (block.type === 'thinking') this.closedThinking += block.thinking;
    }
    this.blocks = [];
    this.rowId = null;
    this.openedAt = null;
    return [{ type: 'message_end', message }];
  }

  /**
   * The turn's blocks as ONE message, for the readers that ask about the whole
   * answer rather than about a row: the background probe's baseline and known
   * tool ids, the goal driver, and the silent-turn verdict.
   */
  turnMessage(): Record<string, unknown> | null {
    const blocks = this.blocks.length > 0 ? [...this.turnBlocks, ...this.blocks] : this.turnBlocks;
    if (blocks.length === 0) return null;
    return {
      role: 'assistant',
      id: 'acp-turn',
      content: blocks.map((block) => ({ ...block })),
    };
  }
}
