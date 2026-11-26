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
 *  1. **The block carries `kind` and `name`; the SERVER resolves the panel.**
 *     There is no `ToolType` translation here any more: the shared resolver
 *     (`shared/lib/chat/tool/render-key.ts`) reads the name, then the kind, and
 *     annotates the block with one `render` family. Doing it in the adapter was
 *     the third of three disagreeing classifications.
 *  2. **`tool_call_update` is a PATCH.** A `status:completed` update carries no
 *     `content`, so replacing the card blanks it at the exact moment it
 *     finishes. The mapper merges into the accumulated call.
 *  3. **`messageId` delimits messages, when present.** ACP has no
 *     `message_end`: one answer is many `agent_message_chunk` frames sharing an
 *     id (measured 6 chunks for a five-word answer, 168 for a long one). Without
 *     the id, one answer becomes 168 rows. The id is optional in ACP v1, so an
 *     agent that omits it (antigravity 1.5.3) gets one synthesized identity for
 *     the turn rather than a fresh one per frame.
 *  4. **`usage_update` is optional.** Only omp emits it; the mapper forwards it
 *     when present and emits nothing when absent, so the panels can say
 *     "not reported" instead of showing a fabricated number.
 */

import { isRecord } from '@kabmo-labs/kabmo-guards';
import { toolInputPath } from '@kabmo-labs/kabmo-chat-tool/tool-input-path';

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
  // MCP tool output commonly carries complete resources. The text form is
  // readable; a blob has no text, so the card names it rather than showing
  // nothing at all.
  if (entry.type === 'resource' && 'resource' in entry && entry.resource && typeof entry.resource === 'object') {
    if ('text' in entry.resource && typeof entry.resource.text === 'string') return entry.resource.text;
    const uri = 'uri' in entry.resource && typeof entry.resource.uri === 'string' ? entry.resource.uri : '';
    return uri ? `[binary resource ${uri}]` : '';
  }
  if (entry.type === 'resource_link' && 'uri' in entry && typeof entry.uri === 'string') {
    const name = 'name' in entry && typeof entry.name === 'string' ? entry.name : entry.uri;
    return `${name} (${entry.uri})`;
  }
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

/** Join a command's two streams the way a terminal would show them. */
function joinStreams(stdout: unknown, stderr: unknown): string | undefined {
  const out = typeof stdout === 'string' ? stdout : '';
  const err = typeof stderr === 'string' ? stderr : '';
  if (!out && !err) return undefined;
  if (!out || !err) return out || err;
  return out.endsWith('\n') ? `${out}${err}` : `${out}\n${err}`;
}

/** The output of a tool call, from either the ACP envelope or omp's own. */
export function acpToolOutput(rawOutput: unknown): string {
  if (rawOutput === undefined || rawOutput === null) return '';
  if (typeof rawOutput === 'string') return rawOutput;
  if (!isRecord(rawOutput)) return JSON.stringify(rawOutput);
  if ('content' in rawOutput) {
    const fromContent = acpContentText(rawOutput.content);
    if (fromContent) return fromContent;
  }
  if (typeof rawOutput.output === 'string' && rawOutput.output) return rawOutput.output;
  if (typeof rawOutput.text === 'string' && rawOutput.text) return rawOutput.text;
  // ACP leaves the result's shape to the adapter. opencode 2.x puts the text
  // under `metadata.output`; the generic command result uses `stdout`/`stderr`
  // (a shape bb normalizes on its side too). Reading only `content`/`output`
  // left those calls with a blank body.
  const metadata = isRecord(rawOutput.metadata) ? rawOutput.metadata : undefined;
  if (metadata && typeof metadata.output === 'string' && metadata.output) return metadata.output;
  const streams = joinStreams(rawOutput.stdout, rawOutput.stderr);
  if (streams) return streams;
  if (typeof rawOutput.output_for_prompt === 'string') return rawOutput.output_for_prompt;
  return '';
}

/** Command facts from one bag: exit status, truncation, timeout, signal. */
function commandDetails(source: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const exit = source.exitCode ?? source.exit_code ?? source.exit;
  if (typeof exit === 'number' && Number.isFinite(exit)) out.exitCode = exit;
  if (typeof source.truncated === 'boolean') out.truncated = source.truncated;
  if (source.timedOut === true || source.timed_out === true || source.timeout === true) out.timedOut = true;
  if (typeof source.signal === 'string' && source.signal) out.signal = source.signal;
  return out;
}

/** The unified diff opencode reports as `metadata.files[]` (edit/write/patch). */
function fileDiffDetails(metadata: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!Array.isArray(metadata.files)) return undefined;
  const patches: string[] = [];
  let path: string | undefined;
  for (const entry of metadata.files) {
    if (!isRecord(entry) || typeof entry.patch !== 'string' || !entry.patch) continue;
    if (!path && typeof entry.file === 'string' && entry.file) path = entry.file;
    patches.push(entry.patch);
  }
  return patches.length > 0
    ? { diff: patches.join('\n'), ...(path ? { path } : {}) }
    : undefined;
}

/** `details` for the renderers that read it (diff, line counts, paths). */
export function acpToolDetails(rawOutput: unknown): Record<string, unknown> | undefined {
  if (!isRecord(rawOutput)) return undefined;
  const base = isRecord(rawOutput.details)
    ? Object.fromEntries(Object.entries(rawOutput.details))
    : undefined;
  const metadata = isRecord(rawOutput.metadata) ? rawOutput.metadata : undefined;
  // The agent's own `details` (omp) wins over anything inferred from the
  // command shapes; the vendor `metadata` fills what that bag does not carry.
  const merged: Record<string, unknown> = {
    ...commandDetails(rawOutput),
    ...(metadata ? commandDetails(metadata) : {}),
    ...(metadata ? fileDiffDetails(metadata) ?? {} : {}),
    ...base,
  };
  return Object.keys(merged).length > 0 ? merged : undefined;
}

/** A minimal unified diff, for ACP's `{type:"diff", oldText, newText}` block. */
function diffText(oldText: string, newText: string, path: string): string {
  const before = oldText ? oldText.split(/\r?\n/) : [];
  const after = newText ? newText.split(/\r?\n/) : [];
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < before.length - prefix
    && suffix < after.length - prefix
    && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  const name = path || 'diff';
  const lines = [
    `--- a/${name}`,
    `+++ b/${name}`,
    `@@ -1,${before.length || 1} +1,${after.length || 1} @@`,
    ...before.slice(Math.max(0, prefix - 2), prefix).map((line) => ` ${line}`),
    ...before.slice(prefix, before.length - suffix).map((line) => `-${line}`),
    ...after.slice(prefix, after.length - suffix).map((line) => `+${line}`),
    ...after.slice(after.length - suffix, after.length - suffix + 2).map((line) => ` ${line}`),
  ];
  return lines.join('\n');
}

/**
 * Details an ACP tool result carries ONLY as content blocks.
 *
 * The spec's `diff` block is the one shape the generic text renderer cannot
 * show: `acpContentText` skips it, so an edit reported that way rendered as an
 * empty card. It is converted to the `details.diff`/`path` pair the Edit panel
 * already reads.
 */
export function acpContentDetails(content: unknown): Record<string, unknown> | undefined {
  if (!Array.isArray(content)) return undefined;
  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    const entry = block as Record<string, unknown>;
    if (entry.type !== 'diff' || typeof entry.newText !== 'string') continue;
    const path = typeof entry.path === 'string' ? entry.path : '';
    // `oldText` is optional in the spec; an absent one is a new file.
    const oldText = typeof entry.oldText === 'string' ? entry.oldText : '';
    return { diff: diffText(oldText, entry.newText, path), ...(path ? { path } : {}) };
  }
  return undefined;
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
  const fromInput = toolInputPath(rawInput);
  if (fromInput) return fromInput;
  if (rawInput && typeof rawInput === 'object') {
    const bag: Record<string, unknown> = Object.fromEntries(Object.entries(rawInput));
    for (const key of ['target', 'command']) {
      const value = bag[key];
      if (typeof value === 'string' && value) return value;
    }
  }
  return undefined;
}
