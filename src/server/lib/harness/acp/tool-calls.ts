/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The tool-call half of the ACP mapper: create on first sight, PATCH afterwards.
 *
 * Split out of `frames.ts` because the v1 and v2 lifecycles now share one
 * accumulator and the file ceiling is real. The rules are the same in both
 * versions:
 *
 *  - a `tool_call_update` for an unknown id CREATES the call (v2 has no separate
 *    create notification; v1's `tool_call` is just the first update);
 *  - every field but `toolCallId` is a patch: omitted = unchanged, `null` =
 *    cleared, a value = replaced;
 *  - a completed/failed/cancelled update often carries no content, so the card's
 *    body must come from the accumulated state.
 *
 * The card itself is a block of the accumulated assistant message, so the host
 * owns that array and the snapshot; this class never touches either directly.
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
import { delegationLabel, resolveToolIdentity } from '@/server/lib/harness/acp/tool-identity';
import type { AcpToolKind, AcpToolStatus } from '@/server/lib/harness/acp/protocol';

/** The message block a tool card renders from. */
export interface ToolCallBlock {
  type: 'toolCall';
  id: string;
  name: string;
  arguments?: Record<string, unknown>;
  toolKind?: AcpToolKind;
  toolType?: string;
  /** The adapter's own kind, when it is not one of the spec's ten. */
  rawKind?: string;
}

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

export interface ToolCallHost {
  pushBlock(block: ToolCallBlock): void;
  snapshot(): Record<string, unknown>;
  /** Frames that close the row the host already painted, before this card is
   *  added to a new one. A card written after prose belongs to the next row:
   *  the timeline draws a row's text above its cards. */
  beginToolBlock(): AgentEvent[];
}

export class AcpToolCalls {
  private readonly calls = new Map<string, OpenTool>();

  constructor(private readonly host: ToolCallHost) {}

  /** Forget per-turn state (an aborted run, a fresh load). */
  reset(): void {
    this.calls.clear();
  }

  /** Tool calls still running — the driver closes them if the agent exits. */
  openCalls(): string[] {
    return [...this.calls.values()]
      .filter((call) => call.status === 'pending' || call.status === 'in_progress' || call.status === 'paused')
      .map((call) => call.id);
  }

  /** First sight of an id: draw the card and register it while it runs. */
  open(update: Record<string, unknown>): AgentEvent[] {
    const toolCallId = typeof update.toolCallId === 'string' ? update.toolCallId : '';
    if (!toolCallId) return [];
    // The identity is resolved, not read off the top level: grok names its tool
    // in `_meta` and cursor names it in `rawInput._toolName`, and reading only
    // `update.name` made a subagent a generic tool (or, with `kind` alone, a
    // file read).
    const identity = resolveToolIdentity(update);
    const rawInput = update.rawInput;
    const args = rawInput && typeof rawInput === 'object' && !Array.isArray(rawInput)
      ? Object.fromEntries(Object.entries(rawInput))
      : undefined;
    const title = typeof update.title === 'string' ? update.title : undefined;
    const name = identity.name ?? title ?? 'tool';
    // A delegation IS a subagent: it gets the `task` panel, not the read/edit
    // one, and its label is the child's task so the card says what it is doing.
    const delegation = delegationLabel(name, args, title);
    const kind = identity.kind;
    const status = typeof update.status === 'string' ? (update.status as AcpToolStatus) : 'pending';
    // A specific kind is authoritative. `other`/absent is only an explicit type
    // when the name is one the renderers know; otherwise the shared parser's
    // own inference from the name is better informed than a forced `read`.
    const toolType = delegation
      ? 'task'
      : kind !== undefined && kind !== 'other'
        ? toolTypeFor(kind, name)
        : isKnownToolName(name) ? toolTypeFor(kind, name) : undefined;

    // Close the prose row FIRST: once this block is in the accumulator, the
    // close would carry the card into the text row and the timeline would draw
    // it above prose the agent sent before it.
    const frames: AgentEvent[] = this.host.beginToolBlock();
    this.host.pushBlock({
      type: 'toolCall',
      id: toolCallId,
      name,
      ...(args ? { arguments: args } : {}),
      ...(kind ? { toolKind: kind } : {}),
      ...(identity.rawKind ? { rawKind: identity.rawKind } : {}),
      ...(toolType ? { toolType } : {}),
    });

    frames.push(
      {
        type: 'message_update',
        message: this.host.snapshot(),
        assistantMessageEvent: { type: 'toolcall_start' },
      },
      {
        type: 'tool_execution_start',
        toolCallId,
        toolName: name,
        ...(toolType ? { toolType } : {}),
        ...(args ? { args } : {}),
        // The child's task for a delegation; the adapter's title otherwise.
        ...(delegation ?? title ? { intent: delegation ?? title } : {}),
        ...(acpToolTarget(update.locations, rawInput) ? { target: acpToolTarget(update.locations, rawInput) } : {}),
      },
    );

    if (isFinal(status)) {
      frames.push(endFrame(update, toolCallId, name, status));
    } else {
      this.calls.set(toolCallId, {
        id: toolCallId,
        name,
        kind,
        title,
        status,
        rawOutput: update.rawOutput,
        content: update.content,
        locations: update.locations,
        startedAt: Date.now(),
      });
    }
    return frames;
  }

  /** Patch an existing call; an unknown id is a create (v2's only shape). */
  patch(update: Record<string, unknown>): AgentEvent[] {
    const toolCallId = typeof update.toolCallId === 'string' ? update.toolCallId : '';
    if (!toolCallId) return [];
    const existing = this.calls.get(toolCallId);
    if (!existing) return this.open(update);

    if (update.rawOutput !== undefined) existing.rawOutput = update.rawOutput;
    if (update.content !== undefined) existing.content = update.content;
    if (update.locations !== undefined) existing.locations = update.locations;
    if (typeof update.title === 'string') existing.title = update.title;
    const status = typeof update.status === 'string' ? (update.status as AcpToolStatus) : existing.status;
    existing.status = status;

    const result = existing.rawOutput ?? (existing.content === undefined ? undefined : { content: existing.content });
    const output = acpToolOutput(existing.rawOutput) || acpContentText(existing.content);
    const details = acpToolDetails(existing.rawOutput) ?? acpContentDetails(existing.content);

    if (isFinal(status)) {
      this.calls.delete(toolCallId);
      return [{
        type: 'tool_execution_end',
        toolCallId,
        toolName: existing.name,
        result,
        isError: status !== 'completed',
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

  /** v2 `tool_call_content_chunk`: append one content item to an open call. */
  appendContent(update: Record<string, unknown>): AgentEvent[] {
    const toolCallId = typeof update.toolCallId === 'string' ? update.toolCallId : '';
    const item = update.content;
    if (!toolCallId || item === undefined || item === null) return [];
    const existing = this.calls.get(toolCallId);
    if (!existing) return this.open({ ...update, content: [item] });
    const current = Array.isArray(existing.content) ? existing.content : [];
    existing.content = [...current, item];
    return [];
  }
}

function isFinal(status: AcpToolStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}

function endFrame(
  update: Record<string, unknown>,
  toolCallId: string,
  name: string,
  status: AcpToolStatus,
): AgentEvent {
  return {
    type: 'tool_execution_end',
    toolCallId,
    toolName: name,
    result: update.rawOutput ?? (update.content === undefined ? undefined : { content: update.content }),
    isError: status !== 'completed',
    details: acpToolDetails(update.rawOutput) ?? acpContentDetails(update.content),
    output: acpToolOutput(update.rawOutput) || acpContentText(update.content),
  };
}
