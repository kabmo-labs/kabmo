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
 *    identity per turn, so its chunks still update ONE row.
 *  - **`tool_call_update` is a PATCH.** A `status:completed` update carries no
 *    `content`, so the card's body lives in the accumulated block; replacing it
 *    blanks the card at the exact moment it finishes.
 *  - **`kind` is the renderer key.** ACP's ten kinds do not all exist in
 *    `ToolType`, so `toolTypeFor` names the translation and the name is kept
 *    alongside it.
 *
 * No I/O: the driver feeds it, the tests feed it, and the same instance serves a
 * live stream and a replay.
 */

import type { AgentEvent } from '@/server/lib/omp/rpc/constants';
import { acpContentText } from '@/server/lib/harness/acp/mapper';
import { planEntries } from '@/server/lib/harness/acp/v2';
import { AcpToolCalls, type ToolCallBlock } from '@/server/lib/harness/acp/tool-calls';

/** One block of the accumulated assistant message, in `parseMessageBlocks` shape. */
type MessageBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string }
  | ToolCallBlock;

/** Per-session accumulator; one instance per live ACP session. */
export class AcpFrameMapper {
  private blocks: MessageBlock[] = [];
  private messageId: string | null = null;
  /** When the turn was dispatched, the base for its duration. */
  private turnStartedAt: number | null = null;
  /** When the open message's first frame arrived, its timeline stamp. */
  private openedAt: number | null = null;
  private readonly tools = new AcpToolCalls({
    pushBlock: (block) => this.blocks.push(block),
    snapshot: () => this.snapshot(),
  });

  /** Forget per-turn state (an aborted run, a fresh load) and start its clock. */
  reset(startedAt: number = Date.now()): void {
    this.blocks = [];
    this.messageId = null;
    this.openedAt = null;
    this.turnStartedAt = startedAt;
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
        // Live user chunks only arrive on replay/steering; the composer already
        // drew the optimistic bubble, so this is a receipt, not a new row.
        return [];
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
      case 'compaction_update':
      case 'compaction_summary_chunk':
        return [];
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
    if (!this.messageId && this.blocks.length === 0) return [];
    const completedAt = Date.now();
    const message = this.snapshot();
    const startedAt = this.turnStartedAt ?? this.openedAt;
    if (startedAt !== null) {
      message.completedAt = completedAt;
      message.duration = Math.max(0, completedAt - startedAt);
    }
    this.blocks = [];
    this.messageId = null;
    this.openedAt = null;
    return [{ type: 'message_end', message }];
  }

  /**
   * The accumulated message in omp's wire shape.
   *
   * `messageId` is OPTIONAL in ACP v1, and an agent that omits it (measured on
   * antigravity 1.5.3: every chunk carried only `sessionUpdate` + `content`)
   * still needs one identity for the whole turn. Without it, `toChatMessage`
   * minted `msg-<Date.now()>-ai` per frame, so every chunk after the first
   * APPENDED a new row instead of updating the streaming one — the turn showed
   * as duplicate bubbles and the final answer again at `message_end`.
   */
  private snapshot(): Record<string, unknown> {
    const id = this.messageId ??= `acp-${crypto.randomUUID()}`;
    const timestamp = this.openedAt ??= Date.now();
    return {
      role: 'assistant',
      id,
      timestamp,
      content: this.blocks.map((block) => ({ ...block })),
    };
  }

  private appendChunk(update: Record<string, unknown>, kind: 'text' | 'thinking'): AgentEvent[] {
    const text = acpContentText(update.content);
    if (!text) return [];
    const frames: AgentEvent[] = [];
    const messageId = typeof update.messageId === 'string' ? update.messageId : null;
    if (messageId && this.messageId && messageId !== this.messageId) frames.push(...this.closeMessage());
    if (messageId) this.messageId = messageId;

    const last = this.blocks[this.blocks.length - 1];
    if (kind === 'text') {
      if (last?.type === 'text') last.text += text;
      else this.blocks.push({ type: 'text', text });
    } else if (last?.type === 'thinking') last.thinking += text;
    else this.blocks.push({ type: 'thinking', thinking: text });

    frames.push({
      type: 'message_update',
      message: this.snapshot(),
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
    if (this.messageId && this.messageId !== messageId) frames.push(...this.closeMessage());
    this.messageId = messageId;
    const raw = update.content;
    const text = raw === null || (Array.isArray(raw) && raw.length === 0) ? '' : acpContentText(raw);
    this.blocks = this.blocks.filter((block) => block.type !== kind);
    if (text) {
      this.blocks.push(kind === 'text' ? { type: 'text', text } : { type: 'thinking', thinking: text });
    }
    frames.push({
      type: 'message_update',
      message: this.snapshot(),
      assistantMessageEvent: {
        type: kind === 'text' ? 'text_delta' : 'thinking_delta',
        delta: text,
      },
    });
    return frames;
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
