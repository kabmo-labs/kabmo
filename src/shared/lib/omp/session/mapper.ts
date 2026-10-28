/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * LIVE-path adapter: omp agent event/message stream → Kabmo ChatMessageData.
 * All content-block parsing is delegated to the shared core parser
 * (parse-message-blocks.ts); this module only handles what is genuinely
 * SSE-specific: streaming tool status, incremental output pairing, notice
 * frames, and Kabmo display timestamps. The JSONL reload path uses the same
 * core via messages-parse.ts — behavior parity is enforced by construction.
 */

import type { ChatMessageData, ToolCallData } from '@/shared/types';
import { extractInlinedTextAttachments, extractText, extractUserImageAttachments, parseMessageBlocks, stripInlinedTextAttachments, toToolCallData } from '@/shared/lib/omp/session/parse-message-blocks';
import { developerTurnNotice, reminderPartIndex } from '@/shared/lib/chat/notice-row';
import { deriveTurnError } from '@/shared/lib/omp/session/turn-error';
import { formatClock } from '@/shared/lib/format/time';
import { toEpochMs } from '@/shared/lib/omp/session/timestamps';

/** Extract plain text from omp content (string or [{type:'text',text},...]). */
export function extractTextFromContent(content: unknown): string {
  return extractText(content);
}

/** Tool events carry result/partialResult as a string or as an omp content
 *  block ({content:[{type:'text',text}]}) — normalize both to plain text. */
export function toolResultText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    const content = (value as { content?: unknown }).content;
    return extractText(content);
  }
  return '';
}

/** Convert an omp AgentMessage (content blocks) into Kabmo ChatMessageData shape.
 *  Custom-role frames (ultrathink-notice, xdev-mount-notice, ...) become a
 *  `notice` row — omp marks them display:false, so they render as an alert,
 *  never as assistant content. */
export function toChatMessage(raw: Record<string, unknown>, streaming = true): ChatMessageData | null {
  if (raw.role === 'custom') {
    if (raw.customType === 'session_exit') return null; // runtime plumbing, not user-visible
    const content = raw.content;
    const text = typeof content === 'string'
      ? content
      : Array.isArray(content)
        ? content
            .map((b) => (b && typeof b === 'object' && (b as { type?: unknown }).type === 'text' ? (b as { text?: unknown }).text ?? '' : ''))
            .join('')
        : '';
    const notice = text.replace(/<\/?system-notice[^>]*>/g, '').trim();
    if (!notice) return null;
    return {
      id: typeof raw.id === 'string' ? raw.id : `notice-${Date.now()}`,
      role: 'ai',
      content: '',
      notice,
      noticeSource: typeof raw.customType === 'string' ? raw.customType : undefined,
    };
  }

  const parsed = parseMessageBlocks(raw.content);
  const id = typeof raw.id === 'string' ? raw.id : `msg-${raw.timestamp ?? Date.now()}-ai`;
  const role = raw.role === 'user' ? 'user' : 'ai';
  const timestamp = typeof raw.timestamp === 'number'
    ? formatClock(raw.timestamp)
    : undefined;
  const attribution = typeof raw.attribution === 'string' ? raw.attribution : undefined;
  const startedAt = toEpochMs(raw.timestamp) ?? toEpochMs(raw.startedAt);
  const durationMs = typeof raw.duration === 'number' ? raw.duration : typeof raw.durationMs === 'number' ? raw.durationMs : undefined;
  const completedAt = toEpochMs(raw.completedAt)
    ?? (startedAt !== undefined && durationMs !== undefined ? startedAt + durationMs : undefined);
  const provider = typeof raw.provider === 'string' ? raw.provider : undefined;

  const reminderIdx = reminderPartIndex(parsed.textParts);
  if (raw.role === 'developer' || raw.role === 'system' || reminderIdx !== undefined) {
    // A reminder envelope keeps its wrapper — `SystemNotice` reads that tag to
    // label the card and strips it before markdown, and the JSONL path stores
    // it the same way so a live row and its reloaded twin are identical.
    // Developer/system turns are notices by role and have no wrapper to keep.
    const notice = developerTurnNotice(typeof raw.role === 'string' ? raw.role : undefined, parsed.textParts)
      ?? (reminderIdx !== undefined ? parsed.textParts[reminderIdx].trim() : undefined);
    if (!notice) return null;
    return {
      id,
      role: 'ai',
      date: timestamp ? `Today, ${timestamp}` : undefined,
      timestamp,
      content: '',
      notice,
    };
  }

  if (role === 'user') {
    const rawText = parsed.textParts.join('\n');
    const text = stripInlinedTextAttachments(rawText);
    // Parity with the JSONL path: the composer's inlined `Attached file:` blocks
    // are the only record of a text attachment, so they are read back into
    // chips here too. Without this a text file vanished from the timeline as
    // soon as the turn was re-rendered from the wire.
    const attachments = [
      ...extractUserImageAttachments(raw.content),
      ...extractInlinedTextAttachments(rawText).map((file, index) => ({
        id: `text-${index + 1}`,
        name: file.name,
        type: 'text/plain',
        preview: '',
        content: file.content,
      })),
    ];
    return {
      id,
      role,
      date: timestamp ? `Today, ${timestamp}` : undefined,
      timestamp,
      startedAt,
      content: text,
      attribution,
      attachments: attachments.map((a) => ({
        id: a.id,
        name: a.name,
        preview: a.preview,
        type: a.type,
        ...('content' in a ? { content: a.content } : {}),
      })),
    };
  }

  const toolCalls: ToolCallData[] = parsed.toolCalls.map((tc) =>
    toToolCallData(tc, { streaming, images: parsed.inlineImages.get(tc.id) }),
  );
  const message: ChatMessageData = {
    id,
    role,
    date: timestamp ? `Today, ${timestamp}` : undefined,
    timestamp,
    attribution,
    model: typeof raw.model === 'string' ? raw.model : undefined,
    provider,
    startedAt,
    completedAt,
    durationMs,
    usage: (raw.usage && typeof raw.usage === 'object') ? (raw.usage as ChatMessageData['usage']) : undefined,
    content: parsed.textParts.join('\n'),
    intent: parsed.intent,
    thinking: parsed.thinking
      ? { thought: parsed.thinking, isGenerating: streaming }
      : (raw.thinking as ChatMessageData['thinking']),
    toolCalls: toolCalls.length > 0 ? toolCalls : (raw.toolCalls as ChatMessageData['toolCalls']),
    summary: typeof raw.summary === 'string' ? raw.summary : undefined,
    // Aborted/errored turns carry no nested `error` — omp writes flat
    // stopReason/errorMessage fields. Derive them so the turn survives the
    // empty-content guard below and renders live instead of only after reload.
    error: (raw.error as ChatMessageData['error']) ?? deriveTurnError(raw),
  };

  if (
    !message.content &&
    !message.thinking &&
    (!message.toolCalls || message.toolCalls.length === 0) &&
    !message.intent &&
    !message.error &&
    !message.summary &&
    !message.notice
  ) {
    return null;
  }

  return message;
}
