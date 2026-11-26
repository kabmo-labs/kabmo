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

import type { AgentEvent } from '@kabmo-labs/kabmo-omp-contracts/events';
import { acpContentDetails,
acpContentText,
acpToolDetails,
acpToolOutput,
acpToolTarget, } from './mapper';
import { delegationLabel, resolveToolIdentity } from './tool-identity';
import { blockOf,
KIND_TOOL_NAME,
terminalMeta,
toolArgs,
type ToolCallBlock, } from './tool-shape';
import type { AcpToolKind, AcpToolStatus } from '@kabmo-labs/kabmo-acp-protocol/protocol';

interface OpenTool {
  id: string;
  name: string;
  kind?: AcpToolKind;
  title?: string;
  status: AcpToolStatus;
  /** The accumulated `rawInput`; a later patch may replace it wholesale. */
  args?: Record<string, unknown>;
  /** The adapter's own kind, when it is not one of the spec's ten. */
  rawKind?: string;
  /** Output an adapter reported through `_meta.terminal_output` (pi-acp). */
  metaOutput?: string;
  /** Exit status an adapter reported through `_meta.terminal_exit`. */
  metaExit?: number;
  rawOutput?: unknown;
  /** `tool_call(Update).content` — where some agents put the diff/output. */
  content?: unknown;
  locations?: unknown;
  startedAt: number;
}

export interface ToolCallHost {
  pushBlock(block: ToolCallBlock): void;
  /** Replace an already-drawn card (a patch that filled in its arguments).
   *  True when the OPEN row holds it, so the caller can emit a refresh. */
  updateBlock(block: ToolCallBlock): boolean;
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
    let args = toolArgs(rawInput);
    const title = typeof update.title === 'string' ? update.title : undefined;
    const kind = identity.kind;
    // pi-acp sends NO arguments for a shell call: its `tool_call.title` IS the
    // command, and its result arrives through the terminal `_meta`. Without
    // this the Bash card had no command line at all. Only a shell call with no
    // command of its own takes the title, so an adapter that sends both keeps
    // the argument it sent.
    if (kind === 'execute' && title && typeof args?.command !== 'string' && typeof args?.cmd !== 'string') {
      args = { ...(args ?? {}), command: title };
    }
    // An adapter that sends NO tool name (codex-acp's file change is `title:
    // "Editing files"` and nothing else) leaves the card with no identity, so
    // the renderer falls back to a generic body. The kind IS the identity
    // there, and naming the call by it is what puts the Edit/Bash/Read panel on
    // the card. A name the adapter DID send is never overridden — the aliases
    // cover those vocabularies, and a plugin may own an unknown name.
    const name = identity.name ?? (kind ? KIND_TOOL_NAME[kind] : undefined) ?? title ?? 'tool';
    // A delegation IS a subagent: it gets the `task` panel, not the read/edit
    // one, and its label is the child's task so the card says what it is doing.
    const delegation = delegationLabel(name, args, title);
    const status = typeof update.status === 'string' ? (update.status as AcpToolStatus) : 'pending';
    // Close the prose row FIRST: once this block is in the accumulator, the
    // close would carry the card into the text row and the timeline would draw
    // it above prose the agent sent before it.
    const frames: AgentEvent[] = this.host.beginToolBlock();
    // The block carries only the FACTS an adapter reported (name, kind,
    // rawKind, args). The renderer family is resolved once on the server from
    // these, so a delegation is named by its canonical name (`task`) rather
    // than by a translation this file invents.
    this.host.pushBlock(blockOf({
      id: toolCallId,
      name,
      title,
      kind,
      args,
      rawKind: identity.rawKind,
    }));

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
        ...(args ? { args } : {}),
        // The child's task for a delegation; the adapter's title otherwise.
        ...(delegation ?? title ? { intent: delegation ?? title } : {}),
        ...(acpToolTarget(update.locations, rawInput) ? { target: acpToolTarget(update.locations, rawInput) } : {}),
      },
    );

    const meta = terminalMeta(update._meta);
    // The call is registered even when this frame already closes it: an
    // adapter may send the result in a SECOND update (`pi-acp` opens a shell
    // call as completed and reports the output in the next frame), and an
    // unregistered id made that update create a duplicate card named after the
    // missing title instead of completing the one on screen.
    this.calls.set(toolCallId, {
      id: toolCallId,
      name,
      kind,
      title,
      status,
      args,
      ...(identity.rawKind ? { rawKind: identity.rawKind } : {}),
      ...(meta.output ? { metaOutput: meta.output } : {}),
      ...(meta.exitCode !== undefined ? { metaExit: meta.exitCode } : {}),
      rawOutput: update.rawOutput,
      content: update.content,
      locations: update.locations,
      startedAt: Date.now(),
    });
    if (isFinal(status)) {
      frames.push(endFrame(update, toolCallId, name, status, meta));
    }
    return frames;
  }

  /** Patch an existing call; an unknown id is a create (v2's only shape). */
  patch(update: Record<string, unknown>): AgentEvent[] {
    const toolCallId = typeof update.toolCallId === 'string' ? update.toolCallId : '';
    if (!toolCallId) return [];
    const existing = this.calls.get(toolCallId);
    if (!existing) return this.open(update);

    // ACP's patch rule applies to `rawInput` too, and opencode RELIES on it:
    // `session.tool.input.started` opens the call with `{}` and the real
    // arguments arrive on the next `tool_call_update`. Ignoring the bag left
    // the Bash card without its command and the Read card without its path.
    // The row is refreshed so the card on screen gets them before the result.
    const frames: AgentEvent[] = [];
    if (update.rawInput !== undefined) {
      existing.args = toolArgs(update.rawInput);
      if (this.host.updateBlock(blockOf(existing))) {
        frames.push({
          type: 'message_update',
          message: this.host.snapshot(),
          assistantMessageEvent: { type: 'toolcall_start' },
        });
      }
    }

    if (update.rawOutput !== undefined) existing.rawOutput = update.rawOutput;
    if (update.content !== undefined) existing.content = update.content;
    if (update.locations !== undefined) existing.locations = update.locations;
    if (typeof update.title === 'string') existing.title = update.title;
    const meta = terminalMeta(update._meta);
    // A terminal channel reports output in DELTAS; pi reports its whole result
    // in one frame. Appending is right for the former and a no-op duplicate for
    // the latter (it sends `terminal_output` once).
    if (meta.output) existing.metaOutput = `${existing.metaOutput ?? ''}${meta.output}`;
    if (meta.exitCode !== undefined) existing.metaExit = meta.exitCode;
    const status = typeof update.status === 'string' ? (update.status as AcpToolStatus) : existing.status;
    existing.status = status;

    const result = existing.rawOutput ?? (existing.content === undefined ? undefined : { content: existing.content });
    const output = acpToolOutput(existing.rawOutput)
      || acpContentText(existing.content)
      || existing.metaOutput
      || '';
    const baseDetails = acpToolDetails(existing.rawOutput) ?? acpContentDetails(existing.content);
    const details = baseDetails || existing.metaExit !== undefined
      ? { ...baseDetails, ...(existing.metaExit !== undefined ? { exitCode: existing.metaExit } : {}) }
      : undefined;

    if (isFinal(status)) {
      this.calls.delete(toolCallId);
      return [...frames, {
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

    return [...frames, {
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
  meta: { output?: string; exitCode?: number } = {},
): AgentEvent {
  const baseDetails = acpToolDetails(update.rawOutput) ?? acpContentDetails(update.content);
  return {
    type: 'tool_execution_end',
    toolCallId,
    toolName: name,
    result: update.rawOutput ?? (update.content === undefined ? undefined : { content: update.content }),
    isError: status !== 'completed',
    details: baseDetails || meta.exitCode !== undefined
      ? { ...baseDetails, ...(meta.exitCode !== undefined ? { exitCode: meta.exitCode } : {}) }
      : undefined,
    output: acpToolOutput(update.rawOutput) || acpContentText(update.content) || meta.output || '',
  };
}
