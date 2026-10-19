/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Activity phrases for the generating indicator, derived from the tool call the
 * agent is actually executing — so the docked row reads `Editing app/x.ts`
 * instead of a generic "Deep reasoning" while files are being written.
 *
 * Both render paths feed this module:
 *   - live omp events   → lib/chat/omp/agent-events.ts
 *                         (tool_execution_start + message_update.assistantMessageEvent)
 *   - mock SSE / reload → lib/chat/timeline/stream-callbacks.ts (ToolCallData)
 *
 * Word tables and subject extraction live in the data-only sibling
 * `tool-phrases.ts`; this module owns the resolution logic. A `write xd://<tool>`
 * call resolves through the inner device, so the phrase is `Running LSP …`
 * rather than `Writing xd://lsp`.
 */

import type { ToolCallData } from '@/shared/types';
import { isRecord } from '@/shared/lib/util/guards';
import { parseProcUrl, procRequestOp } from '@/shared/lib/omp/session/proc';
import { DEVICE_VERBS, PHASE_VERBS, TOOL_ALIASES, TOOL_VERBS, asString, pick, subjectFor, truncate } from '@/shared/lib/chat/timeline/tool-phrases';

export interface ToolActivity {
  /** Canonical omp tool name; legacy Kabmo aliases are normalized. */
  name?: string;
  /** Raw tool arguments (live event stream) — the richest subject source. */
  args?: unknown;
  /** Raw tool arguments from a Kabmo ToolCallData. */
  input?: unknown;
  /** Pre-extracted command/target from a Kabmo ToolCallData. */
  command?: string;
  target?: string;
  /** omp's `i` field: the model's own one-line intent, used as a fallback. */
  intent?: string;
}

/** Build the args record for a call, backfilling from Kabmo ToolCallData fields. */
function argsOf(tool: ToolActivity): Record<string, unknown> {
  const source = isRecord(tool.args) ? tool.args : isRecord(tool.input) ? tool.input : {};
  const args: Record<string, unknown> = { ...source };
  if (tool.command && asString(args.command) === undefined && asString(args.cmd) === undefined) {
    args.command = tool.command;
  }
  if (tool.target && asString(args.path) === undefined) args.path = tool.target;
  return args;
}

/** Inner `xd://<device>` name carried by a write call, if any. */
function xdDeviceOf(args: Record<string, unknown>, tool: ToolActivity): string | undefined {
  const candidate = pick(args, ['path', 'target']) ?? asString(tool.target) ?? asString(tool.command);
  if (!candidate || !candidate.startsWith('xd://')) return undefined;
  const device = candidate.slice('xd://'.length).split(/[/?#\s]/)[0];
  return device || undefined;
}

/** Inner device arguments: a `write xd://…` payload is JSON in `content`.
 *  The transport keys are always dropped so the phrase never echoes the
 *  device URL; prose payloads (resolve/reject/report_issue) surface their
 *  first line as the subject instead. */
function deviceArgs(args: Record<string, unknown>): Record<string, unknown> {
  const { path: _path, target: _target, command: _command, i: _i, ...rest } = args;
  const content = args.content;
  if (typeof content !== 'string') return rest;
  try {
    const parsed: unknown = JSON.parse(content);
    if (isRecord(parsed)) return { ...rest, ...parsed };
  } catch {
    // Not JSON: fall through to the prose form.
  }
  const firstLine = content.trim().split('\n', 1)[0]?.trim();
  return firstLine ? { ...rest, prose: firstLine } : rest;
}

/** Phrase for the tool call the agent is executing right now. */
export function describeToolActivity(tool: ToolActivity): string {
  const rawName = asString(tool.name) ?? '';
  const name = TOOL_ALIASES[rawName.toLowerCase()] ?? rawName.toLowerCase();
  const args = argsOf(tool);
  // The model's own one-liner (omp's `i` field, or the intent it resolved for
  // the execution event) is a better subject than anything derived here.
  const intent = asString(tool.intent) ?? pick(args, ['i']);

  // A `proc://` call is `read`/`write` transport, so the URL — not the tool —
  // names the operation: `Reading proc://kabmo-dev` would describe a
  // service stop as a file read.
  const proc = parseProcUrl(asString(args.path));
  if (proc) {
    const action = procRequestOp(asString(args.path), rawName);
    const verb =
      action === 'kill'
        ? 'Stopping'
        : action === 'mode'
          ? 'Setting mode on'
          : action === 'stdin'
            ? 'Sending input to'
            : proc.id
              ? 'Reading process'
              : 'Listing processes';
    return truncate(proc.id ? `${verb} ${proc.id}` : verb);
  }

  const device = xdDeviceOf(args, tool);
  if (device) {
    const mcpTool = device.startsWith('mcp__') ? device.slice(5) : undefined;
    const verb = mcpTool
      ? `Running ${mcpTool}`
      : DEVICE_VERBS[device] ?? `Running ${device}`;
    const subject = subjectFor(mcpTool ?? device, deviceArgs(args));
    if (subject) return truncate(`${verb} ${subject}`);
    if (intent) return truncate(intent);
    return truncate(verb);
  }

  const stem = TOOL_VERBS[name];
  const verb = stem ?? (name ? `Running ${name}` : 'Working');
  const subject = subjectFor(name, args);
  if (subject) return truncate(`${verb} ${subject}`);
  if (intent) return truncate(intent);
  // Stems are complete activities, so an unknown subject never dangles: a tool
  // call that has not streamed its arguments yet still reads `Writing`.
  return truncate(verb);
}

/** Phrase for a Kabmo ToolCallData row (mock SSE path and reloaded history). */
export function describeToolCall(tool: ToolCallData): string {
  return describeToolActivity({
    name: tool.name ?? tool.type,
    input: tool.input,
    command: tool.command,
    target: tool.target,
    intent: tool.intent,
  });
}

/**
 * Tool call block a streaming `toolcall_start` / `toolcall_delta` event is
 * building. The event's own `toolCall` field only lands on `toolcall_end`; while
 * the call streams, the block lives at `partial.content[contentIndex]` — and it
 * already carries `name`, which is what lets the indicator name the action
 * immediately instead of showing an intermediate "preparing" state.
 */
function streamingToolCall(event: Record<string, unknown>): Record<string, unknown> | undefined {
  const partial = event.partial;
  if (!isRecord(partial)) return undefined;
  const content = partial.content;
  if (!Array.isArray(content)) return undefined;
  const index = typeof event.contentIndex === 'number' ? event.contentIndex : content.length - 1;
  const block = content[index];
  if (!isRecord(block) || block.type !== 'toolCall') return undefined;
  return block;
}

/**
 * Phrase for an `AssistantMessageEvent` riding a `message_update` frame —
 * `thinking_*` → Thinking, `text_*` → Writing response, and `toolcall_*` → the
 * tool's own phrase (`Writing`, `Running`, `Reading`) from the moment the call
 * starts streaming, then with its object once the arguments are known.
 */
export function describeAssistantPhase(event: unknown): string | undefined {
  if (!isRecord(event)) return undefined;
  const type = asString(event.type);
  if (!type) return undefined;
  if (type.startsWith('thinking')) return PHASE_VERBS.thinking;
  if (type.startsWith('text')) return PHASE_VERBS.writing;
  if (type === 'toolcall_start' || type === 'toolcall_delta') {
    const block = streamingToolCall(event);
    if (!block) return undefined;
    return describeToolActivity({ name: asString(block.name), args: block.arguments });
  }
  if (type === 'toolcall_end') {
    const call = event.toolCall;
    if (!isRecord(call)) return undefined;
    return describeToolActivity({ name: asString(call.name), args: call.arguments });
  }
  return undefined;
}
