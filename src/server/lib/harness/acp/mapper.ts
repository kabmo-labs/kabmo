/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * ACP `session/update` -> the frame vocabulary `foldAgentEvent` already folds.
 *
 * This is the whole adapter contract. The timeline, the tool cards, the
 * thinking accordion and the usage chip stay untouched because they receive the
 * SAME events they receive from omp — the transport is the only thing that
 * changed.
 *
 * Four rules, each pinned by a measurement against a real agent:
 *
 *  1. **`kind` becomes `ToolCallData.type`**, `name` stays `name`. Kabmo's
 *     `resolveToolKey` reads `tool.name` first, then the title, then
 *     `tool.type`; a card renders from `kind` only if the mapper puts it in
 *     `type`. ACP's ten kinds do not all exist in `ToolType`, so the table below
 *     names the translation rather than casting.
 *  2. **`tool_call_update` is a PATCH.** A `status:completed` update carries no
 *     `content`, so replacing the card blanks it at the exact moment it
 *     finishes. The mapper merges into the accumulated call.
 *  3. **`messageId` delimits messages.** ACP has no `message_end`: one answer is
 *     many `agent_message_chunk` frames sharing an id (measured 6 chunks for a
 *     five-word answer, 168 for a long one). Without the id, one answer becomes
 *     168 rows.
 *  4. **`usage_update` is optional.** Only omp emits it; the mapper forwards it
 *     when present and emits nothing when absent, so the panels can say
 *     "not reported" instead of showing a fabricated number.
 */

import type { ToolType } from '@/shared/types';
import type { AcpToolKind } from '@/server/lib/harness/acp/protocol';

/** ACP kind -> the omp-shaped `ToolType` the renderers key on. */
const TOOL_TYPE_BY_KIND: Record<AcpToolKind, ToolType> = {
  read: 'read',
  edit: 'edit',
  delete: 'edit',
  move: 'edit',
  search: 'grep',
  execute: 'bash',
  think: 'read',
  fetch: 'web_search',
  switch_mode: 'todo',
  other: 'read',
};

/** The `type` a card should carry, with `name` able to override a generic kind.
 *  `other` is the case that matters: an agent that sends `kind:"other"` plus a
 *  real `name` (`edit`) still gets the right renderer. */
export function toolTypeFor(kind: AcpToolKind | undefined, name: string | undefined): ToolType {
  const mapped = TOOL_TYPE_BY_KIND[kind ?? 'other'] ?? 'read';
  if (kind !== undefined && kind !== 'other') return mapped;
  const known: ToolType[] = ['read', 'edit', 'write', 'bash', 'grep', 'web_search', 'todo'];
  const lowered = (name ?? '').toLowerCase() as ToolType;
  return known.includes(lowered) ? lowered : mapped;
}

/**
 * The text of one ACP content entry, narrowed field by field.
 *
 * Both shapes a measured agent sends are handled: a bare `{type:"text", text}`
 * block, and the wrapped `{type:"content", content:{type:"text", text}}` form
 * `session/update.tool_call` uses. Narrowing through `typeof` keeps the read
 * checked — the payload arrives from another process.
 */
function entryText(entry: unknown): string {
  if (!entry || typeof entry !== 'object') return '';
  if (!('type' in entry)) return '';
  if (entry.type === 'text' && 'text' in entry && typeof entry.text === 'string') return entry.text;
  if (entry.type === 'content' && 'content' in entry) return entryText(entry.content);
  return '';
}

/**
 * Text out of an ACP content value.
 *
 * Three shapes reach here and all three occur in a real stream:
 *  - a SINGLE block, which is what `session/update` message chunks carry
 *    (measured: `"content": {"type":"text","text":"ok"}`);
 *  - an ARRAY of blocks, which is what `tool_call.content[]` carries;
 *  - a bare string, which some adapters send for a tool title.
 *
 * Handling only the array silently dropped every streamed message, which is the
 * exact failure the mapper tests exist to catch.
 */
export function acpContentText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const entry of content) {
      const text = entryText(entry);
      if (text) parts.push(text);
    }
    return parts.join('\n');
  }
  return entryText(content);
}

/** The output of a tool call, from either the ACP envelope or omp's own. */
export function acpToolOutput(rawOutput: unknown): string {
  if (rawOutput === undefined || rawOutput === null) return '';
  if (typeof rawOutput === 'string') return rawOutput;
  if (typeof rawOutput !== 'object') return JSON.stringify(rawOutput);
  if ('content' in rawOutput) {
    const fromContent = acpContentText(rawOutput.content);
    if (fromContent) return fromContent;
  }
  if ('output' in rawOutput && typeof rawOutput.output === 'string') return rawOutput.output;
  if ('text' in rawOutput && typeof rawOutput.text === 'string') return rawOutput.text;
  return '';
}

/** `details` for the renderers that read it (diff, line counts, paths). */
export function acpToolDetails(rawOutput: unknown): Record<string, unknown> | undefined {
  if (!rawOutput || typeof rawOutput !== 'object' || !('details' in rawOutput)) return undefined;
  const details = rawOutput.details;
  if (!details || typeof details !== 'object') return undefined;
  return Object.fromEntries(Object.entries(details));
}

/** The `tool_execution_end` boolean: ACP reports failure as a STATUS. */
export function acpToolFailed(status: unknown): boolean {
  return status === 'failed';
}

/** First path a tool call touched, for the card's target line. */
export function acpToolTarget(locations: unknown, rawInput: unknown): string | undefined {
  if (Array.isArray(locations)) {
    for (const entry of locations) {
      if (entry && typeof entry === 'object' && 'path' in entry && typeof entry.path === 'string' && entry.path) {
        return entry.path;
      }
    }
  }
  if (rawInput && typeof rawInput === 'object') {
    const bag: Record<string, unknown> = Object.fromEntries(Object.entries(rawInput));
    for (const key of ['path', 'file', 'target', 'filePath', 'command']) {
      const value = bag[key];
      if (typeof value === 'string' && value) return value;
    }
  }
  return undefined;
}
