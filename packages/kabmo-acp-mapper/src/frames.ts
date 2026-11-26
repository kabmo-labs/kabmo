/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The stateful half of the ACP adapter: one session's accumulated assistant
 * message, turned into the frames `foldAgentEvent` already folds.
 *
 * It accumulates a WHOLE message and emits `message_update` carrying it, which
 * is exactly the shape omp's `set_event_filter(messageUpdates:"full")` produces
 * (see `rpc/child-config.ts`). That is not a shortcut: the fold's
 * `toChatMessage` builds the card list from `content[]` blocks, so a frame that
 * carried only a text delta would render prose and NOTHING else — no tool cards,
 * no thinking accordion, and no `lastToolMessageRef` for a result to pair onto.
 *
 * Three ACP facts drive the state kept here:
 *
 *  - **`messageId` delimits messages, but is OPTIONAL.** One answer is many
 *    chunks sharing an id (measured 6 chunks for a five-word answer, 168 for a
 *    long one); a changed id closes the row and opens the next. An agent that
 *    sends no id at all (measured on antigravity 1.5.3) gets one synthesized
 *    identity per row, so its chunks still update ONE row.
 *  - **`tool_call_update` is a PATCH.** A `status:completed` update carries no
 *    `content`, so the card's body lives in the accumulated block; replacing it
 *    blanks the card at the exact moment it finishes.
 *  - **`kind` is a FACT, not a renderer key.** The block carries the adapter's
 *    `kind`/`name`; the SERVER resolves the panel once
 *    (`shared/lib/chat/tool/render-key.ts`) and annotates the block with one
 *    `render` family. Translating `kind` here made this the third of three
 *    classifications that could disagree.
 *
 * The blocks themselves — and where a row ENDS — live in `message-rows.ts`:
 * a row never holds prose written after one of its cards, because the timeline
 * draws a row's text above its cards.
 *
 * No I/O: the driver feeds it, the tests feed it, and the same instance serves a
 * live stream and a replay.
 */

import type { AgentEvent } from '@kabmo-labs/kabmo-omp-contracts/events';
import { acpContentText } from './mapper';
import { AcpMessageRows } from './message-rows';
import { planEntries } from '@kabmo-labs/kabmo-acp-protocol/v2';
import { AcpToolCalls } from './tool-calls';

/** Per-session accumulator; one instance per live ACP session. */
export class AcpFrameMapper {
  private readonly rows = new AcpMessageRows();
  /** True only while a restore is replaying retained history. User turns then
   *  become rows: live `user_message` frames are receipts for a bubble the
   *  composer already drew, but a replay is the first time the client sees
   *  them. */
  private replaying = false;
  /** The user turn currently being replayed, if any. */
  private replayUser: { id: string; text: string; timestamp: number } | null = null;
  private readonly tools = new AcpToolCalls({
    pushBlock: (block) => this.rows.push(block),
    updateBlock: (block) => this.rows.updateToolBlock(block.id, block),
    snapshot: () => this.rows.snapshot(),
    // Content is already on screen; the card belongs to the NEXT row, or the
    // timeline would draw it above text that was written before it.
    beginToolBlock: () => (this.rows.endsWithContent() ? this.rows.close() : []),
  });

  /** Enter or leave replay mode. Leaving drops the half-accumulated user turn so
   *  a later live frame cannot append to the restored row. */
  setReplaying(on: boolean): void {
    this.replaying = on;
    if (!on) this.replayUser = null;
  }

  /** Forget per-turn state (an aborted run, a fresh load) and start its clock. */
  reset(startedAt: number = Date.now()): void {
    this.rows.reset(startedAt);
    this.tools.reset();
  }

  /** Tool calls still running — the driver closes them if the agent exits
   *  mid-turn, so no card is left spinning forever. */
  openCalls(): string[] {
    return this.tools.openCalls();
  }

  /**
   * Turn one `session/update` payload into zero or more Kabmo frames.
   *
   * An array rather than emitting, so ordering is explicit: a changed
   * `messageId` closes the previous row BEFORE the next chunk opens one, and a
   * tool call emits both a message refresh and its start frame.
   */
  mapUpdate(update: Record<string, unknown>): AgentEvent[] {
    switch (typeof update.sessionUpdate === 'string' ? update.sessionUpdate : '') {
      case 'agent_message_chunk':
        return this.appendChunk(update, 'text');
      case 'agent_thought_chunk':
        return this.appendChunk(update, 'thinking');
      // v2 whole-message upserts: replace that message's content, keep tool blocks.
      case 'agent_message':
        return this.upsertMessage(update, 'text');
      case 'agent_thought':
        return this.upsertMessage(update, 'thinking');
      case 'user_message':
      case 'user_message_chunk':
        // Live user chunks only arrive on steering; the composer already drew
        // the optimistic bubble, so this is a receipt, not a new row. During a
        // RESTORE it is the only copy of the user turn, so it becomes one.
        return this.replaying ? this.replayUserFrames(update) : [];
      case 'tool_call':
        return this.tools.open(update);
      case 'tool_call_update':
        return this.tools.patch(update);
      case 'tool_call_content_chunk':
        return this.tools.appendContent(update);
      // v2's turn boundary is handled by `AcpTurns.onStateUpdate`, not mapped.
      case 'state_update':
      case 'terminal_update':
      case 'terminal_output_chunk':
        return [];
      // Compaction has no card of its own, but it is a LIVE event the operator
      // must see: a chat that silently spends a minute rewriting its context
      // reads as a hang. `session.compaction` is advertised, so an agent may
      // send these, and a notice is the surface that exists.
      case 'compaction_update':
      case 'compaction_summary_chunk':
        return this.compaction(update);
      case 'usage_update':
        return this.usage(update);
      case 'available_commands_update':
        return [{ type: 'available_commands_update', commands: update.availableCommands ?? [] }];
      case 'session_info_update':
        return [{
          type: 'session_info_update',
          title: typeof update.title === 'string' ? update.title : undefined,
          updatedAt: typeof update.updatedAt === 'string' ? update.updatedAt : undefined,
        }];
      case 'current_mode_update':
        return [{ type: 'mode_changed', modeId: update.currentModeId }];
      case 'config_option_update':
        return [{ type: 'config_changed', configOptions: update.configOptions ?? [] }];
      case 'plan':
        // The spec defines it; no measured agent sends it. Forwarded so a future
        // adapter lights the panel with no change here.
        return [{ type: 'plan_updated', entries: update.entries ?? [] }];
      case 'plan_update':
        // v2 keyed plans; Kabmo's Todos panel renders one list.
        return [{ type: 'plan_updated', entries: planEntries(update) }];
      case 'notice':
        return [{
          type: 'notice',
          level: typeof update.severity === 'string' ? update.severity : 'info',
          message: [update.title, update.description]
            .filter((part) => typeof part === 'string' && part)
            .join(' — '),
        }];
      default:
        // An unknown variant is data, not an error: adapters add their own.
        return [];
    }
  }

  /** Close the open assistant row (turn end, abort, disconnect). */
  closeMessage(): AgentEvent[] {
    return this.rows.close();
  }

  /**
   * The turn's blocks as ONE message, for the readers that ask about the whole
   * answer rather than about a row: the background probe's baseline and known
   * tool ids, the goal driver, and the silent-turn verdict.
   */
  turnMessage(): Record<string, unknown> | null {
    return this.rows.turnMessage();
  }

  /** Turn a replayed user turn into a row.
   *
   *  The adapter sends the first `user_message` with empty content and the text
   *  in `user_message_chunk` (measured on codex and claude), so the row is
   *  opened on the first non-empty text and updated by later chunks of the same
   *  `messageId`. The assistant accumulator is deliberately untouched: a user
   *  turn must not close or reopen the answer's message. */
  private replayUserFrames(update: Record<string, unknown>): AgentEvent[] {
    const text = acpContentText(update.content);
    const id = typeof update.messageId === 'string' && update.messageId
      ? `user-${update.messageId}`
      : this.replayUser?.id ?? `user-${crypto.randomUUID()}`;
    if (!this.replayUser || this.replayUser.id !== id) {
      this.replayUser = { id, text: '', timestamp: Date.now() };
    }
    if (!text) return [];
    const opened = this.replayUser.text.length > 0;
    this.replayUser.text += text;
    const message: Record<string, unknown> = {
      role: 'user',
      id: this.replayUser.id,
      timestamp: this.replayUser.timestamp,
      content: [{ type: 'text', text: this.replayUser.text }],
    };
    return [{ type: opened ? 'message_update' : 'message_start', message }];
  }

  private appendChunk(update: Record<string, unknown>, kind: 'text' | 'thinking'): AgentEvent[] {
    const text = acpContentText(update.content);
    if (!text) return [];
    const frames: AgentEvent[] = [];
    const messageId = typeof update.messageId === 'string' ? update.messageId : null;
    const openId = this.rows.acpMessageId;
    if (messageId && openId && messageId !== openId) frames.push(...this.rows.close());
    if (messageId) this.rows.setAcpMessageId(messageId);
    // Content written AFTER a card is its own row: the timeline draws a row's
    // text/thinking above its cards, so keeping both in one row moved the card
    // above content the agent wrote first. `close()` keeps the ACP id, so the
    // rest of this message continues the new row.
    if (this.rows.endsWithTool()) frames.push(...this.rows.close());

    this.rows.appendContent(kind, text);
    frames.push({
      type: 'message_update',
      message: this.rows.snapshot(),
      // The fold reads this only to name the activity phrase; the message above
      // is what actually renders. `text_delta`/`thinking_delta` keep the
      // existing "Writing…"/"Thinking…" wording.
      assistantMessageEvent: {
        type: kind === 'text' ? 'text_delta' : 'thinking_delta',
        delta: text,
      },
    });
    return frames;
  }

  /**
   * v2 whole-message upsert: replace that message's blocks of one kind.
   *
   * Tool-call blocks are entities of their own in v2; they stay in place, and
   * the text/thinking content for the message is replaced wholesale.
   */
  private upsertMessage(update: Record<string, unknown>, kind: 'text' | 'thinking'): AgentEvent[] {
    const messageId = typeof update.messageId === 'string' ? update.messageId : '';
    if (!messageId || !('content' in update)) return [];
    const frames: AgentEvent[] = [];
    const openId = this.rows.acpMessageId;
    if (openId && openId !== messageId) frames.push(...this.rows.close());
    this.rows.setAcpMessageId(messageId);
    const raw = update.content;
    const full = raw === null || (Array.isArray(raw) && raw.length === 0) ? '' : acpContentText(raw);
    // A split moves earlier content into closed rows, but a v2 upsert keeps
    // sending the message's whole content — draw only what is not drawn yet.
    const text = this.rows.contentDelta(kind, full);
    // Same boundary as `appendChunk`: a v2 message that already painted a card
    // and now carries content must not fold that content under the card.
    if (text && this.rows.endsWithTool()) frames.push(...this.rows.close());
    this.rows.replaceContent(kind, text);
    frames.push({
      type: 'message_update',
      message: this.rows.snapshot(),
      assistantMessageEvent: {
        type: kind === 'text' ? 'text_delta' : 'thinking_delta',
        delta: text,
      },
    });
    return frames;
  }

  /** One compaction frame as a notice, or nothing once it is complete. */
  private compaction(update: Record<string, unknown>): AgentEvent[] {
    const failed = typeof update.error === 'string' && update.error.length > 0;
    return [{
      type: 'notice',
      level: failed ? 'warning' : 'info',
      message: failed ? `Compaction failed: ${update.error}` : 'Compacting the conversation…',
    }];
  }

  private usage(update: Record<string, unknown>): AgentEvent[] {
    const size = typeof update.size === 'number' ? update.size : undefined;
    const used = typeof update.used === 'number' ? update.used : undefined;
    const rawCost = update.cost;
    const cost = rawCost && typeof rawCost === 'object' && 'amount' in rawCost && typeof rawCost.amount === 'number'
      ? rawCost.amount
      : undefined;
    if (size === undefined && used === undefined) return [];
    return [{ type: 'usage_updated', size, used, cost }];
  }
}

/** Frame emitted when a `session/prompt` resolves: ACP's only turn terminal. */
export function turnEndFrame(result: { stopReason?: string } | undefined): AgentEvent {
  const stopReason = result?.stopReason;
  const cancelled = stopReason === 'cancelled' || stopReason === 'canceled';
  return {
    type: 'agent_end',
    isTerminal: true,
    ...(stopReason ? { stopReason } : {}),
    ...(cancelled ? { cancelled: true } : {}),
  };
}
