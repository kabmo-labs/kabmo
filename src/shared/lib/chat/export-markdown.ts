/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * A session transcript as one Markdown document.
 *
 * The export is a reading copy, not a replay: it keeps the turns, the thinking
 * blocks, the tool calls and their output, and drops the UI-only fields (ids,
 * durations, usage). A tool call is fenced so a command or a diff survives a
 * paste into an issue; a notice is a blockquote so it cannot be mistaken for
 * the assistant's answer.
 *
 * Pure and shared: the menu action fetches the transcript, this module decides
 * what the file says, and a test can pin the shape without a DOM.
 */

import type { AgentActionData, ChatMessageData, ToolCallData } from '@/shared/types';
import { isNoticeRow, messageAnswerText } from '@kabmo-labs/kabmo-chat-notices/notice-row';
import { parseOrchestrationBlock } from '@/shared/lib/chat/orchestration/notice';

export interface SessionMarkdownInput {
  id: string;
  title?: string;
  messages: ChatMessageData[];
  /** Clock for the header; injected so a test does not depend on today. */
  exportedAt?: Date;
}

/** A fence longer than any backtick run inside `text`, so the block cannot close early. */
function fence(text: string, language = ''): string {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  const ticks = '`'.repeat(Math.max(3, longest + 1));
  return `${ticks}${language}\n${text.replace(/\s+$/, '')}\n${ticks}`;
}

/** Every line quoted, so a multi-line notice stays one block. */
function quote(text: string): string {
  return text
    .trim()
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');
}

function attachmentLines(msg: ChatMessageData): string[] {
  const attachments = Array.isArray(msg.attachments) ? msg.attachments : [];
  if (attachments.length === 0) return [];
  const names = attachments.map((attachment) => {
    const kind = attachment.type ? ` (${attachment.type})` : '';
    return `- ${attachment.name || 'attachment'}${kind}`;
  });
  return ['**Attachments:**', ...names];
}

function thinkingBlock(msg: ChatMessageData): string[] {
  const thinking = msg.thinking;
  if (!thinking) return [];
  const text = typeof thinking === 'string' ? thinking : thinking.thought;
  if (!text?.trim()) return [];
  return ['<details>', '<summary>Thinking</summary>', '', text.trim(), '', '</details>'];
}

function toolCallBlock(call: ToolCallData | AgentActionData): string[] {
  const tool = call as ToolCallData;
  const title = tool.title || tool.name || tool.type || 'Tool';
  const status = tool.status ? ` — ${tool.status}` : '';
  const lines = [`**Tool: ${title}**${status}`];

  const command = tool.command ?? (typeof tool.input === 'string' ? tool.input : undefined);
  if (command?.trim()) lines.push('', fence(command.trim(), 'sh'));

  if (tool.input && typeof tool.input === 'object') {
    const input = JSON.stringify(tool.input, null, 2);
    if (input !== '{}') lines.push('', fence(input, 'json'));
  }

  if (tool.diff?.diffText?.trim()) lines.push('', fence(tool.diff.diffText.trim(), 'diff'));

  if (tool.output?.trim()) lines.push('', fence(tool.output.trim()));

  if (tool.error?.trim()) lines.push('', `> **Error:** ${tool.error.trim()}`);

  return lines;
}

/** The heading an injected prompt exports under. Kabmo wrote it, so it is not
 *  filed as the operator's own turn — the same distinction the timeline draws
 *  with a card. */
const ORCHESTRATION_HEADING: Record<string, string> = {
  contract: '## Orchestration',
  worker: '## Worker brief',
  outcome: '## Worker outcome',
};

function messageBlock(msg: ChatMessageData): string[] {
  if (isNoticeRow(msg)) {
    return ['## System notice', '', quote(msg.notice)];
  }

  const injected = msg.role === 'user' ? parseOrchestrationBlock(messageAnswerText(msg)) : null;
  if (injected) {
    const lines = [ORCHESTRATION_HEADING[injected.kind] ?? '## Orchestration', '', injected.body];
    // The operator's own words stay their turn, exactly as the timeline keeps
    // their bubble beside the card.
    if (injected.rest) lines.push('', '## User', '', injected.rest);
    return lines;
  }

  const heading = msg.role === 'user' ? '## User' : '## Assistant';
  const lines: string[] = [heading];
  const content = messageAnswerText(msg).trim();
  if (content) lines.push('', content);

  const attachments = attachmentLines(msg);
  if (attachments.length > 0) lines.push('', ...attachments);

  const thinking = thinkingBlock(msg);
  if (thinking.length > 0) lines.push('', ...thinking);

  const calls = [...(msg.toolCalls ?? msg.actions ?? []), ...(msg.actions2 ?? [])];
  for (const call of calls) {
    const block = toolCallBlock(call);
    if (block.length > 0) lines.push('', ...block);
  }

  if (msg.error?.message?.trim()) lines.push('', `> **Error:** ${msg.error.message.trim()}`);
  if (msg.systemNote?.trim()) lines.push('', `> **System:** ${msg.systemNote.trim()}`);
  if (msg.irc?.message?.trim()) {
    lines.push('', `> **IRC from ${msg.irc.from}:** ${msg.irc.message.trim()}`);
  }

  return lines;
}

/** The whole session as one Markdown document. */
export function sessionToMarkdown({ id, title, messages, exportedAt = new Date() }: SessionMarkdownInput): string {
  const name = title?.trim() || `Session ${id}`;
  const header = [
    `# ${name}`,
    '',
    `- **Session ID:** \`${id}\``,
    `- **Exported:** ${exportedAt.toISOString()}`,
  ];
  const body = messages.flatMap((msg) => ['', ...messageBlock(msg)]);
  return `${[...header, ...body].join('\n').trim()}\n`;
}

/** A filesystem-safe `.md` name derived from the session title. */
export function sessionMarkdownFileName(title: string | undefined, id: string): string {
  const base = (title ?? '')
    .trim()
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 80);
  const fallback = `session-${id}`.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-');
  return `${base || fallback}.md`;
}
