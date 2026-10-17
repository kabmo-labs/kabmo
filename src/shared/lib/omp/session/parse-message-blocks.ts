/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Single source of truth for parsing omp message content blocks (text /
 * thinking / toolCall / toolResult) into the chamber's parsed-message shape.
 *
 * Both render paths share this core so their behavior can never drift:
 * - live SSE events:  hooks/chat/omp/stream.ts → mapper.ts (streaming=true)
 * - JSONL reload:     lib/omp/session/messages-parse.ts → messages-map.ts
 *
 * The two adapters only handle what is genuinely path-specific: the entry
 * wrapper shape, the streaming status of tool calls, and output pairing
 * (incremental in live, 2-pass on reload).
 */

import type { ToolCallData, ToolType } from '@/shared/types/chat';
import { hashlineTargetPath } from '@/shared/lib/omp/session/hashline-patch';
import { extractToolImages, type ToolImageRef } from '@/shared/lib/omp/session/tool-images';
import { isRecord } from '@/shared/lib/util/guards';

/** Extract plain text from omp content (string or [{type:'text',text},...]). */
export function extractText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const block of content) {
    if (!isRecord(block)) continue;
    if (block.type === 'text' && typeof block.text === 'string') parts.push(block.text);
  }
  return parts.join('\n');
}

export interface ParsedToolCall {
  id: string;
  name: string;
  title: string;
  intent?: string;
  target?: string;
  command?: string;
  input?: string | Record<string, unknown>;
}

export interface ParsedMessageBlocks {
  thinking?: string;
  toolCalls: ParsedToolCall[];
  /** toolCallId → text output carried by inline toolResult blocks. */
  inlineOutputs: Map<string, string>;
  /** toolCallId → pictures the inline toolResult blocks returned. */
  inlineImages: Map<string, ToolImageRef[]>;
  textParts: string[];
  /** Short human intent (omp arguments.i) for the tool calls in this turn. */
  intent?: string;
}

function inferToolType(name?: string): ToolType {
  const lower = (name || '').toLowerCase();
  if (lower.includes('bash') || lower.includes('terminal') || lower.includes('shell') || lower.includes('run')) {
    return 'bash';
  }
  if (lower.includes('write') || lower.includes('edit') || lower.includes('patch') || lower.includes('apply')) {
    return 'edit_file';
  }
  if (lower.includes('create')) return 'create_file';
  if (lower.includes('read') || lower.includes('view') || lower.includes('list')) return 'read_file';
  if (lower.includes('grep') || lower.includes('glob')) return 'grep';
  if (lower.includes('search') || lower.includes('find')) return 'search_fs';
  if (lower.includes('web') || lower.includes('fetch') || lower.includes('http')) return 'web_search';
  if (lower.includes('todo')) return 'todo';
  if (lower.includes('task')) return 'task';
  if (lower.includes('lsp')) return 'lsp';
  if (lower.includes('eval')) return 'eval';
  if (lower.includes('github')) return 'github';
  if (lower.includes('security')) return 'security_scan';
  return 'custom';
}

export { inferToolType };

function stringArg(rawInput: Record<string, unknown> | undefined, keys: string[]): string {
  if (!rawInput) return '';
  for (const key of keys) {
    const value = rawInput[key];
    if (typeof value === 'string') return value;
  }
  return '';
}

const COMMAND_KEYS = ['command', 'cmd', 'CommandLine', 'commandLine'];
const TARGET_KEYS = ['path', 'TargetFile', 'targetFile', 'FilePath', 'filePath', 'AbsolutePath', 'file'];

/** Parse omp message content (string or block array) into the canonical
 *  parsed-message shape shared by the live and reload render paths. */
export function parseMessageBlocks(content: unknown): ParsedMessageBlocks {
  const result: ParsedMessageBlocks = { toolCalls: [], inlineOutputs: new Map(), inlineImages: new Map(), textParts: [] };
  if (typeof content === 'string') {
    result.textParts.push(content);
    return result;
  }
  if (!Array.isArray(content)) return result;

  for (const [blockIndex, raw] of content.entries()) {
    if (!isRecord(raw)) continue;
    const block = raw as {
      type?: unknown;
      text?: unknown;
      thinking?: unknown;
      narration?: unknown;
      id?: unknown;
      name?: unknown;
      toolCallId?: unknown;
      arguments?: unknown;
      input?: unknown;
    };
    if (block.type === 'thinking') {
      const body = typeof block.thinking === 'string'
        ? block.thinking
        : typeof block.text === 'string'
          ? block.text
          : undefined;
      // omp 18.12.0 marks a thinking block whose text is prose addressed to the
      // USER (`narration`), and its own surfaces present it as answer text
      // (`presentNarrationAsAnswer`, used by the TUI, print mode and ACP).
      // Folding it into `thinking` hid the reply inside a collapsed "Thinking"
      // accordion; the two render paths share this parser, so the rule is
      // stated once here.
      if (body !== undefined && block.narration === true) result.textParts.push(body);
      else if (body !== undefined) result.thinking = body;
    } else if (block.type === 'toolCall') {
      // The child streams FULL accumulated messages (`child-config.ts`), so the
      // block carries omp's own `id` and `name` from the first delta. The
      // fallbacks cover a frame that somehow omits them (a hand-built fixture, a
      // build that ignores the filter): a random id would re-key the card on
      // every frame and remount it per chunk, while the block's position is
      // stable for the whole stream.
      const id = typeof block.id === 'string' ? block.id : `tool-${blockIndex}`;
      const name = typeof block.name === 'string' ? block.name : 'tool';
      const rawInput = (block.arguments ?? block.input) as Record<string, unknown> | undefined;
      const args = isRecord(rawInput) ? rawInput : undefined;
      const command = stringArg(args, COMMAND_KEYS);
      // An omp `edit` carries its target inside the patch header (`input:
      // "[PATH#TAG]\nCUT …"`) — no `path` key — so the card would otherwise
      // render without a file name until the result's `details.path` arrives.
      const target = stringArg(args, TARGET_KEYS) || (args ? hashlineTargetPath(args) : undefined);
      const intent = typeof args?.i === 'string' ? args.i : undefined;
      const detail = command || target;
      result.toolCalls.push({
        id,
        name,
        title: detail ? `${name} — ${detail}` : name,
        intent,
        target: target || undefined,
        command: command || undefined,
        input: args && Object.keys(args).length > 0 ? args : undefined,
      });
      if (intent && !result.intent) result.intent = intent;
      result.inlineOutputs.set(id, '');
    } else if (block.type === 'toolResult') {
      const targetId = typeof block.toolCallId === 'string' ? block.toolCallId : undefined;
      const text = typeof block.text === 'string' ? block.text : '';
      const images = extractToolImages(raw);
      if (targetId && result.inlineOutputs.has(targetId)) {
        result.inlineOutputs.set(targetId, text);
        if (images.length > 0) result.inlineImages.set(targetId, images);
      } else if (result.toolCalls.length > 0) {
        const last = result.toolCalls[result.toolCalls.length - 1];
        if (text) result.inlineOutputs.set(last.id, text);
        if (images.length > 0) result.inlineImages.set(last.id, images);
      }
    } else if (block.type === 'text') {
      if (typeof block.text === 'string') result.textParts.push(block.text);
    }
  }
  return result;
}

/** Build a chamber ToolCallData from the parsed core shape. `streaming`
 *  controls the initial status (live calls start 'running'); pairing an
 *  output after the fact overrides it back to success/error. */
export function toToolCallData(
  parsed: ParsedToolCall,
  options: { streaming: boolean; output?: string; isError?: boolean; images?: ToolImageRef[] },
): ToolCallData {
  const input = parsed.input;
  const stripped = isRecord(input)
    ? Object.fromEntries(Object.entries(input).filter(([key]) => key !== 'i'))
    : input;
  const status: ToolCallData['status'] = options.isError
    ? 'error'
    : options.output !== undefined
      ? 'success'
      : options.streaming ? 'running' : 'success';
  return {
    id: parsed.id,
    type: inferToolType(parsed.name),
    name: parsed.name,
    title: parsed.title,
    intent: parsed.intent,
    target: parsed.target,
    command: parsed.command,
    input: stripped && Object.keys(stripped).length > 0 ? stripped : undefined,
    output: options.output,
    ...(options.images && options.images.length > 0 ? { images: options.images } : {}),
    status,
  };
}

/**
 * A user-attachment entry extracted from an omp content block. `blobRef` is set
 * when omp externalized the bytes instead of inlining them (see
 * `@/server/lib/omp/session/blobs.server`); the server resolves it before the
 * timeline sees the attachment, so `preview` here is only a placeholder.
 */
export interface ExtractedImageAttachment {
  id: string;
  name: string;
  preview: string;
  type: string;
  /** `blob:sha256:<hash>` when the bytes were externalized, else undefined. */
  blobRef?: string;
}

/** True for the `blob:sha256:<hash>` references omp writes in place of image data. */
export function isBlobImageRef(data: string): boolean {
  return data.startsWith('blob:sha256:');
}

/** Extract image blocks from an omp user content array ({type:'image',
 *  data: base64 | blob:sha256:<hash>, mimeType}) into ChatMessageData attachment
 *  entries so the timeline keeps showing them after a reload from the session
 *  JSONL. A blob ref carries no preview: building one from the ref string
 *  produced an undecodable `data:` URL, which is what the server-side resolver
 *  now replaces with the real bytes. */
export function extractUserImageAttachments(
  content: unknown,
): ExtractedImageAttachment[] {
  if (!Array.isArray(content)) return [];
  const attachments: ExtractedImageAttachment[] = [];
  let index = 0;
  for (const block of content) {
    if (!isRecord(block) || block.type !== 'image') continue;
    const data = typeof block.data === 'string' ? block.data : undefined;
    const mimeType = typeof block.mimeType === 'string' ? block.mimeType : 'image/png';
    if (!data) continue;
    index += 1;
    const ext = (mimeType.split('/')[1] || 'png').replace(/[^a-z0-9]/gi, '') || 'png';
    const externalized = isBlobImageRef(data);
    attachments.push({
      id: `att-${index}`,
      name: `attachment-${index}.${ext}`,
      preview: externalized ? '' : `data:${mimeType};base64,${data}`,
      type: mimeType,
      ...(externalized ? { blobRef: data } : {}),
    });
  }
  return attachments;
}

/** Strip the inlined "Attached file: ..." fenced blocks that the composer
 *  appends to the prompt before sending (mirror omp-web). The JSONL stores
 *  the composed prompt; the timeline should show the original text only —
 *  the file itself renders as an attachment chip. Handles both a leading
 *  block (attach-only prompt) and one appended after the user text. */
export function stripInlinedTextAttachments(text: string): string {
  const match = text.match(/(?:^|\n{2})\s*Attached file: /);
  if (!match || match.index === undefined) return text;
  const before = text.slice(0, match.index);
  const rest = text.slice(match.index + match[0].length);
  if (!/^[^\n]+\n```[a-z]*\n/.test(rest)) return text;
  return before.trim();
}

/** One text file recovered from an inlined `Attached file:` block. */
export interface InlinedTextAttachment {
  name: string;
  content: string;
}

/**
 * Recover the text files the composer inlined into a delivered prompt.
 *
 * omp stores no attachment metadata for a text file: the composer appends each
 * one to the prompt as `Attached file: <name>` plus a fenced block, and that
 * composed prompt IS the session record. `stripInlinedTextAttachments` removes
 * those blocks for display, which also throws the names away — so a reloaded
 * session showed no chip for a dropped `.md`/`.py`/`.json` while its image
 * siblings survived (images ride as their own content block).
 *
 * This walks the same format back out, so the timeline can render the chips and
 * re-open the files. The fence length is whatever `fenceForContent` chose (at
 * least 3 backticks, longer when the content itself contains a run), and a
 * block's content may contain anything — including the literal string
 * "Attached file:" — so the closing fence is matched by exact length rather
 * than by looking for the next header.
 */
export function extractInlinedTextAttachments(text: string): InlinedTextAttachment[] {
  const attachments: InlinedTextAttachment[] = [];
  const header = /(?:^|\n{2})Attached file: ([^\n]+)\n(`{3,})[a-zA-Z0-9_-]*\n/g;
  let match: RegExpExecArray | null;
  while ((match = header.exec(text)) !== null) {
    const name = match[1].trim();
    const fence = match[2];
    const contentStart = match.index + match[0].length;
    // The closing fence sits on its own line and repeats the opening run
    // exactly; a longer run is content, not the close.
    const closer = `\n${fence}`;
    let cursor = contentStart;
    let end = -1;
    while (cursor <= text.length) {
      const at = text.indexOf(closer, cursor);
      if (at === -1) break;
      const after = text.slice(at + closer.length);
      // Accept the close only at a block boundary: end of string, or a blank
      // line followed by the next header / nothing.
      if (after === '' || after.startsWith('\n') || /^\n{2}Attached file: /.test(after)) {
        end = at;
        break;
      }
      cursor = at + closer.length;
    }
    if (end === -1) continue;
    attachments.push({ name, content: text.slice(contentStart, end) });
    header.lastIndex = end + closer.length;
  }
  return attachments;
}
