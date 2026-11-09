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
import {
  acpContentDetails,
  acpContentText,
  acpToolDetails,
  acpToolOutput,
  acpToolTarget,
  isKnownToolName,
  toolTypeFor,
} from '@/server/lib/harness/acp/mapper';
import type { AcpToolKind, AcpToolStatus } from '@/server/lib/harness/acp/protocol';

/** One block of the accumulated assistant message, in `parseMessageBlocks` shape. */
type MessageBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string }
  | { type: 'toolCall'; id: string; name: string; arguments?: Record<string, unknown>; toolKind?: AcpToolKind; toolType?: string };

interface OpenTool {
  id: string;
  name: string;
  kind?: AcpToolKind;
  title?: string;
  status: AcpToolStatus;
  rawOutput?: unknown;
  /** `tool_call(Update).content` — where some agents put the diff/output. */
  content?: unknown;
  locations?: unknown;
  startedAt: number;
}

/** Per-session accumulator; one instance per live ACP session. */
export class AcpFrameMapper {
  private blocks: MessageBlock[] = [];
  private messageId: string | null = null;
  private readonly open = new Map<string, OpenTool>();

  /** Forget per-turn state (an aborted run, a fresh load). */
  reset(): void {
    this.blocks = [];
    this.messageId = null;
    this.open.clear();
  }

  /** Tool calls still running — the driver closes them if the agent exits
   *  mid-turn, so no card is left spinning forever. */
  openCalls(): string[] {
    return [...this.open.values()]
      .filter((call) => call.status === 'pending' || call.status === 'in_progress')
      .map((call) => call.id);
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
      case 'user_message_chunk':
        // Live user chunks only arrive on replay/steering; the composer already
        // drew the optimistic bubble, so this is a receipt, not a new row.
        return [];
      case 'tool_call':
        return this.openTool(update);
      case 'tool_call_update':
        return this.patchTool(update);
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
    const message = this.snapshot();
    this.blocks = [];
    this.messageId = null;
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
    return {
      role: 'assistant',
      id,
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

  private openTool(update: Record<string, unknown>): AgentEvent[] {
    const toolCallId = typeof update.toolCallId === 'string' ? update.toolCallId : '';
    if (!toolCallId) return [];
    const name = typeof update.name === 'string' && update.name
      ? update.name
      : typeof update.title === 'string' && update.title
        ? update.title
        : 'tool';
    const kind = typeof update.kind === 'string' ? (update.kind as AcpToolKind) : undefined;
    const status = typeof update.status === 'string' ? (update.status as AcpToolStatus) : 'pending';
    // A specific kind is authoritative. `other`/absent is only an explicit type
    // when the name is one the renderers know; otherwise the shared parser's
    // own inference from the name is better informed than a forced `read`.
    const toolType = kind !== undefined && kind !== 'other'
      ? toolTypeFor(kind, name)
      : isKnownToolName(name) ? toolTypeFor(kind, name) : undefined;
    const rawInput = update.rawInput;
    const args = rawInput && typeof rawInput === 'object' && !Array.isArray(rawInput)
      ? Object.fromEntries(Object.entries(rawInput))
      : undefined;

    // The card is drawn from the message block, so opening a call means adding
    // the block and re-emitting the message — not emitting a separate card row.
    // `toolType` travels with the block: the shared parser's name inference
    // cannot know that ACP `kind:"execute"` means bash when the name is `Shell`.
    this.blocks.push({
      type: 'toolCall',
      id: toolCallId,
      name,
      ...(args ? { arguments: args } : {}),
      ...(kind ? { toolKind: kind } : {}),
      ...(toolType ? { toolType } : {}),
    });

    const frames: AgentEvent[] = [
      { type: 'message_update', message: this.snapshot(), assistantMessageEvent: { type: 'toolcall_start' } },
      {
        type: 'tool_execution_start',
        toolCallId,
        toolName: name,
        ...(toolType ? { toolType } : {}),
        ...(args ? { args } : {}),
        ...(typeof update.title === 'string' ? { intent: update.title } : {}),
        ...(acpToolTarget(update.locations, rawInput) ? { target: acpToolTarget(update.locations, rawInput) } : {}),
      },
    ];

    // Some agents announce a call ONLY once it is finished (`tool_call` with
    // `status:"completed"` and no later update). Leaving it in the open map
    // meant the turn's cleanup closed it as an ERROR, overwriting a success.
    if (status === 'completed' || status === 'failed') {
      frames.push({
        type: 'tool_execution_end',
        toolCallId,
        toolName: name,
        result: update.rawOutput ?? (update.content === undefined ? undefined : { content: update.content }),
        isError: status === 'failed',
        details: acpToolDetails(update.rawOutput) ?? acpContentDetails(update.content),
        output: acpToolOutput(update.rawOutput) || acpContentText(update.content),
      });
    } else {
      this.open.set(toolCallId, {
        id: toolCallId,
        name,
        kind,
        title: typeof update.title === 'string' ? update.title : undefined,
        status,
        rawOutput: update.rawOutput,
        content: update.content,
        locations: update.locations,
        startedAt: Date.now(),
      });
    }
    return frames;
  }

  /**
   * `tool_call_update` is a PATCH: every field but `toolCallId` is optional and
   * an omitted one means UNCHANGED. Merging is what keeps a completed card's
   * body — measured, the completion update carries only `status` and
   * `rawOutput.details`.
   */
  private patchTool(update: Record<string, unknown>): AgentEvent[] {
    const toolCallId = typeof update.toolCallId === 'string' ? update.toolCallId : '';
    if (!toolCallId) return [];
    const existing = this.open.get(toolCallId);
    // An update for a call this mapper never saw (a replay window, a resumed
    // session): treat it as an opening call rather than dropping the work.
    if (!existing) return this.openTool(update);

    if (update.rawOutput !== undefined) existing.rawOutput = update.rawOutput;
    if (update.content !== undefined) existing.content = update.content;
    if (update.locations !== undefined) existing.locations = update.locations;
    if (typeof update.title === 'string') existing.title = update.title;
    const status = typeof update.status === 'string' ? (update.status as AcpToolStatus) : existing.status;
    existing.status = status;

    // Some agents report the result as `content` blocks instead of `rawOutput`;
    // the diff block only becomes visible through the details bridge.
    const result = existing.rawOutput ?? (existing.content === undefined ? undefined : { content: existing.content });
    const output = acpToolOutput(existing.rawOutput) || acpContentText(existing.content);
    const details = acpToolDetails(existing.rawOutput) ?? acpContentDetails(existing.content);

    if (status === 'completed' || status === 'failed') {
      const failed = status === 'failed';
      this.open.delete(toolCallId);
      return [{
        type: 'tool_execution_end',
        toolCallId,
        toolName: existing.name,
        result,
        isError: failed,
        details,
        durationMs: Math.max(0, Date.now() - existing.startedAt),
        output,
      }];
    }

    return [{
      type: 'tool_execution_update',
      toolCallId,
      toolName: existing.name,
      partialResult: result,
      // The ACP output shape may nest text (`{type:"content", content:{…}}`),
      // which `toolResultText` does not walk. The flattened read travels with
      // the raw result so the card is not blank while the call is running.
      output,
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
