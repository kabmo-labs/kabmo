/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * JSONL reload adapter (`messages-map.ts`) and the role/block helpers it
 * consumes (`messages-parse.ts`).
 *
 * The reload path must render a session identically to the live path, but it
 * reads a *different* record shape (an `{type:'message', message:{…}}` entry)
 * and so has its own branch rules. Pinned here: the role spelling omp uses
 * (`developer`/`custom`/`toolResult` all fold to `assistant`, while a real
 * `assistant` becomes Kabmo's `ai`), the two-pass tool-result pairing
 * that drops an orphaned result entry but keeps its output attached to the
 * call, and the custom-entry filter that must not print Kabmo mode
 * bookkeeping into the timeline.
 *
 * The last block drives the whole reload through `loadSessionMessages`: file
 * order must survive, a torn line must not cost the rest of the session, and
 * the thinking level omp records as its own `thinking_level_change` entry must
 * be stamped onto the turns that actually ran under it — not the last level of
 * the session.
 */

import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  collectToolOutputs,
  noticeFromCustomMessage,
  toChatMessage,
} from '@/shared/lib/omp/session/messages-map';
import { parseAssistantContent, resultOutput, roleFor } from '@/shared/lib/omp/session/messages-parse';
import type { OmpMessageEntry } from '@/shared/lib/omp/session/messages-parse';
import { isNoticeRow } from '@/shared/lib/chat/notice-row';
import { loadSessionMessages } from '@/server/lib/omp/session/messages';

const entry = (message: Record<string, unknown>, extra: Record<string, unknown> = {}): OmpMessageEntry =>
  ({ type: 'message', id: 'e1', timestamp: '2026-01-02T03:04:05.000Z', message, ...extra }) as OmpMessageEntry;

describe('roleFor', () => {
  test('maps omp roles onto Kabmo vocabulary', () => {
    expect(roleFor('user')).toBe('user');
    expect(roleFor('assistant')).toBe('ai');
  });

  test('folds developer, custom, toolResult and system onto assistant', () => {
    // omp spells these roles differently; the fold is the base-role fallback
    // for a JSONL row. A developer/system turn then becomes a notice row by
    // role (the notice branch overrides), never assistant content.
    expect(roleFor('developer')).toBe('assistant');
    expect(roleFor('custom')).toBe('assistant');
    expect(roleFor('toolResult')).toBe('assistant');
    expect(roleFor('system')).toBe('assistant');
  });

  test('an unknown or missing role is assistant, never user', () => {
    expect(roleFor(undefined)).toBe('assistant');
    expect(roleFor('')).toBe('assistant');
    expect(roleFor('weird')).toBe('assistant');
  });
});

describe('resultOutput', () => {
  test('joins text blocks with a newline and skips binary blocks', () => {
    const message = { content: [{ type: 'text', text: 'a' }, { type: 'image', data: 'A' }, { type: 'text', text: 'b' }] };
    expect(resultOutput(message)).toBe('a\nb');
  });

  test('does not trim — whitespace in tool output is real output', () => {
    expect(resultOutput({ content: [{ type: 'text', text: '  padded  ' }] })).toBe('  padded  ');
  });

  test('is empty for a missing message or a non-array content', () => {
    expect(resultOutput(undefined)).toBe('');
    expect(resultOutput({ content: 'plain string' })).toBe('');
  });
});

describe('parseAssistantContent', () => {
  test('pairs an inline toolResult with its tool call and finishes it as success', () => {
    const parsed = parseAssistantContent([
      { type: 'thinking', thinking: 'hmm' },
      { type: 'toolCall', id: 'c1', name: 'read', arguments: { path: '/f', i: 'Read it' } },
      { type: 'toolResult', toolCallId: 'c1', text: 'OUT' },
      { type: 'text', text: 'answer' },
    ]);
    expect(parsed.thinking).toBe('hmm');
    expect(parsed.intent).toBe('Read it');
    expect(parsed.textParts).toEqual(['answer']);
    expect(parsed.toolCalls).toEqual([
      { id: 'c1', type: 'read_file', name: 'read', title: 'read — /f', intent: 'Read it', target: '/f', input: { path: '/f' }, output: 'OUT', status: 'success' },
    ]);
  });

  test('a plain string content becomes one text part', () => {
    expect(parseAssistantContent('hello')).toEqual({ thinking: undefined, toolCalls: [], textParts: ['hello'], intent: undefined });
  });

  test('a tool call with no output stays success on the reload path (it is not streaming)', () => {
    const parsed = parseAssistantContent([{ type: 'toolCall', id: 'c1', name: 'bash', arguments: { command: 'ls' } }]);
    expect(parsed.toolCalls[0]?.status).toBe('success');
  });
});

describe('toChatMessage — reload entry shape', () => {
  test('returns null for an entry with no message payload', () => {
    expect(toChatMessage({ type: 'message', id: 'e' } as OmpMessageEntry)).toBeNull();
  });

  test('keeps a user turn and recovers its inlined text attachment', () => {
    const msg = toChatMessage(entry({ role: 'user', content: 'q\n\nAttached file: a.md\n```markdown\nA\n```' }));
    expect(msg?.role).toBe('user');
    if (!msg?.attachments) throw new Error('expected the inlined file to become an attachment');
    expect(msg?.content).toBe('q');
    expect(msg?.attachments as unknown).toEqual([{ id: 'text-1', name: 'a.md', preview: '', type: 'text/plain', content: 'A' }]);
  });

  test('drops a user turn that is empty and carries no attachment', () => {
    expect(toChatMessage(entry({ role: 'user', content: '' }))).toBeNull();
  });

  test('takes startedAt from the message timestamp, falling back to the entry timestamp', () => {
    expect(toChatMessage(entry({ role: 'assistant', content: 'x' }))?.startedAt).toBe(1767323045000);
    expect(toChatMessage(entry({ role: 'assistant', content: 'x', timestamp: 1737000000000 }))?.startedAt).toBe(1737000000000);
  });

  test('drops a paired toolResult entry — its output is folded into the call instead', () => {
    const msg = toChatMessage(entry({ role: 'toolResult', content: [{ type: 'text', text: 'out' }], toolCallId: 'c1' }));
    expect(msg).toBeNull();
  });

  test('renders an orphaned toolResult as an assistant system note', () => {
    const msg = toChatMessage(entry({ role: 'toolResult', content: [{ type: 'text', text: 'out' }], toolName: 'bash' }));
    expect(msg?.role).toBe('assistant');
    expect(msg?.systemNote).toBe('[bash] out');
  });

  test('drops an orphaned toolResult with neither text nor tool name', () => {
    expect(toChatMessage(entry({ role: 'toolResult', content: [] }))).toBeNull();
  });

  test('maps an assistant turn with thinking, model, provider and duration', () => {
    const msg = toChatMessage(entry({ role: 'assistant', content: [{ type: 'text', text: 'ans' }, { type: 'thinking', thinking: 'th' }], model: 'm', provider: 'p', duration: 10 }));
    expect(msg?.role).toBe('ai');
    expect(msg?.content).toBe('ans');
    expect(msg?.thinking).toEqual({ thought: 'th', isGenerating: false });
    expect(msg?.model).toBe('m');
    expect(msg?.provider).toBe('p');
    expect(msg?.completedAt).toBe(1767323045000 + 10);
  });

  test('marks every tool call of an isError turn as error', () => {
    const msg = toChatMessage(entry({ role: 'assistant', content: [{ type: 'toolCall', id: 'c1', name: 'bash', arguments: {} }], isError: true }));
    expect(msg?.toolCalls?.[0]?.status).toBe('error');
  });

  test('moves a reminder envelope out of content and into notice', () => {
    const msg = toChatMessage(entry({
      role: 'assistant',
      content: [{ type: 'text', text: '<system-reminder>stop</system-reminder>' }, { type: 'text', text: 'body' }],
    }));
    expect(msg?.notice).toBe('<system-reminder>stop</system-reminder>');
    expect(msg?.content).toBe('body');
  });

  test('a developer turn is a notice row, never assistant prose', () => {
    // omp writes harness nudges (a malformed tool call, a rule reminder) as
    // role `developer`; the live mapper renders them as a notice card, and
    // the reload path must agree — as assistant content the raw prompt (and
    // its DSML markup) showed up as if the model had said it.
    const nudge = 'Tool call failed: your previous response tried to invoke a tool, but the tool-call markup was malformed, so it arrived as plain text, no tool was executed.\n\n```\n<｜DSML｜tool_calls>\n```';
    const msg = toChatMessage(entry({ role: 'developer', content: [{ type: 'text', text: nudge }] }));
    expect(msg?.role).toBe('ai');
    expect(msg?.content).toBe('');
    expect(msg?.notice).toBe(nudge);
    expect(isNoticeRow(msg)).toBe(true);
  });

  test('an errored turn with no text is kept so the failure stays visible', () => {
    const msg = toChatMessage(entry({ role: 'assistant', content: [], stopReason: 'aborted', errorMessage: 'x' }));
    expect(msg?.error).toEqual({ status: undefined, id: undefined, message: 'x', stopReason: 'aborted' });
  });

  test('a turn with nothing at all yields null', () => {
    expect(toChatMessage(entry({ role: 'assistant', content: [] }))).toBeNull();
  });
});

describe('collectToolOutputs', () => {
  const result = (callId: string | undefined, text: string, extra: Record<string, unknown> = {}) => ({
    type: 'message',
    message: { role: 'toolResult', ...(callId ? { toolCallId: callId } : {}), content: [{ type: 'text', text }], ...extra },
  });

  test('appends a later distinct chunk to the earlier one', () => {
    expect(collectToolOutputs([result('c', 'one'), result('c', 'two')]).get('c')?.output).toBe('one\ntwo');
  });

  test('keeps the longer text when one chunk contains the other', () => {
    expect(collectToolOutputs([result('c', 'abc'), result('c', 'abcdef')]).get('c')?.output).toBe('abcdef');
    expect(collectToolOutputs([result('c', 'abcdef'), result('c', 'abc')]).get('c')?.output).toBe('abcdef');
  });

  test('ignores a duplicate that differs only in surrounding whitespace', () => {
    expect(collectToolOutputs([result('c', 'abc'), result('c', '  abc  ')]).get('c')?.output).toBe('abc');
  });

  test('skips a toolResult with no toolCallId and non-message records', () => {
    expect(collectToolOutputs([result(undefined, 'x'), { type: 'other' }]).size).toBe(0);
  });

  test('carries details and a sticky isError across chunks', () => {
    const outputs = collectToolOutputs([result('c', 'a', { details: { p: 1 }, isError: true }), result('c', 'b')]);
    expect(outputs.get('c')?.details).toEqual({ p: 1 });
    expect(outputs.get('c')?.isError).toBe(true);
  });

  test('records an image the result returned', () => {
    const image = { type: 'message', message: { role: 'toolResult', toolCallId: 'c', content: [{ type: 'image', data: 'A'.repeat(64), mimeType: 'image/png' }] } };
    expect(collectToolOutputs([image]).get('c')?.images).toEqual([{ mimeType: 'image/png', dataBase64: 'A'.repeat(64) }]);
  });
});

describe('noticeFromCustomMessage', () => {
  test('drops session_exit and Kabmo mode bookkeeping entries', () => {
    expect(noticeFromCustomMessage({ customType: 'session_exit', content: 'bye' })).toBeNull();
    expect(noticeFromCustomMessage({ customType: 'chamber-goal-state', content: 'x' })).toBeNull();
    expect(noticeFromCustomMessage({ customType: 'chamber-plan-state', content: 'x' })).toBeNull();
  });

  test('strips ANSI and the system-notice wrapper from the text', () => {
    const msg = noticeFromCustomMessage({ customType: 'launch-completion', id: 'n1', timestamp: '2026-01-02T03:04:05.000Z', content: '\u001b[31mred\u001b[0m' });
    expect(msg).toEqual({ id: 'n1', role: 'ai', content: '', notice: 'red', noticeSource: 'launch-completion', date: '2026-01-02T03:04:05.000Z' });
  });

  test('joins text blocks and ignores non-text blocks', () => {
    const msg = noticeFromCustomMessage({ customType: 'goal-continuation', content: [{ type: 'text', text: 'a' }, { type: 'image' }, { type: 'text', text: 'b' }] });
    expect(msg?.notice).toBe('ab');
    expect(msg?.noticeSource).toBe('goal-continuation');
  });

  test('drops an entry with no prose', () => {
    expect(noticeFromCustomMessage({ customType: 'x', content: '   ' })).toBeNull();
    expect(noticeFromCustomMessage({ customType: 'x', content: { type: 'text', text: 'a' } })).toBeNull();
  });

  test('an entry with no customType is still a notice, without a source', () => {
    const msg = noticeFromCustomMessage({ content: 'hi' });
    expect(msg?.notice).toBe('hi');
    expect(msg?.noticeSource).toBeUndefined();
  });
});

const tempDirs: string[] = [];
afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

/** Write a session JSONL whose lines are exactly the given records, in order. */
function writeSession(records: unknown[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'omp-map-test-'));
  tempDirs.push(dir);
  const file = join(dir, 'session.jsonl');
  writeFileSync(file, `${records.map((record) => JSON.stringify(record)).join('\n')}\n`);
  return file;
}

const at = (second: number) => `2026-01-02T03:04:${String(second).padStart(2, '0')}.000Z`;

describe('loadSessionMessages — ordering and thinking-level stamping', () => {
  test('keeps the file order and stamps the level in effect, not the session level', async () => {
    const messages = await loadSessionMessages(writeSession([
      { type: 'message', id: 'u1', timestamp: at(1), message: { role: 'user', content: 'q' } },
      { type: 'message', id: 'a1', timestamp: at(2), message: { role: 'assistant', content: 'one' } },
      { type: 'thinking_level_change', id: 'chg', thinkingLevel: 'high' },
      { type: 'message', id: 'a2', timestamp: at(3), message: { role: 'assistant', content: 'two' } },
      { type: 'thinking_level_change', id: 'chg2', thinkingLevel: null },
      { type: 'message', id: 'a3', timestamp: at(4), message: { role: 'assistant', content: 'three' } },
    ]));
    expect(messages.map((msg) => msg.id)).toEqual(['u1', 'a1', 'a2', 'a3']);
    // A turn before the first change record has no level to show, and a user
    // turn is never stamped — only the assistant turns carry the footer level.
    expect(messages.map((msg) => msg.thinkingLevel)).toEqual([undefined, undefined, 'high', 'off']);
  });

  test('a torn line is skipped without losing the rest of the session', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'omp-map-test-'));
    tempDirs.push(dir);
    const file = join(dir, 'torn.jsonl');
    writeFileSync(file, [
      JSON.stringify({ type: 'message', id: 'a1', timestamp: at(1), message: { role: 'assistant', content: 'kept' } }),
      '{"type":"message","id":"torn"',
      JSON.stringify({ type: 'message', id: 'a2', timestamp: at(2), message: { role: 'assistant', content: 'also kept' } }),
    ].join('\n'));
    const messages = await loadSessionMessages(file);
    expect(messages.map((msg) => msg.id)).toEqual(['a1', 'a2']);
  });

  test('a notice row keeps its place in the chronology', async () => {
    const messages = await loadSessionMessages(writeSession([
      { type: 'message', id: 'a1', timestamp: at(1), message: { role: 'assistant', content: 'before' } },
      { type: 'custom_message', id: 'n1', customType: 'ultrathink-notice', timestamp: at(2), content: [{ type: 'text', text: '<system-notice>mid</system-notice>' }] },
      { type: 'message', id: 'a2', timestamp: at(3), message: { role: 'assistant', content: 'after' } },
    ]));
    expect(messages.map((msg) => msg.id)).toEqual(['a1', 'n1', 'a2']);
    expect(messages[1]?.notice).toBe('mid');
  });

  test('an injected entry in a session file keeps its row in the timeline', async () => {
    // omp writes these for the model (a todo nudge, the eval runtime snapshot)
    // with `display:false`. The Kabmo renders them anyway: they are part of
    // the session record, and a reader who wants the full transcript gets it.
    const messages = await loadSessionMessages(writeSession([
      { type: 'message', id: 'u1', timestamp: at(1), message: { role: 'user', content: 'run it' } },
      { type: 'custom_message', id: 'ctx', customType: 'eval-state-context', timestamp: at(2), display: false, content: '<system-reminder>Eval runtime state is host-retained.</system-reminder>' },
      { type: 'custom_message', id: 'nudge', customType: 'mid-run-todo-nudge', timestamp: at(3), display: false, content: '<system-reminder>7 todo items still open.</system-reminder>' },
      { type: 'message', id: 'a1', timestamp: at(4), message: { role: 'assistant', content: 'done' } },
    ]));
    expect(messages.map((msg) => msg.id)).toEqual(['u1', 'ctx', 'nudge', 'a1']);
    expect(messages[1]?.noticeSource).toBe('eval-state-context');
    expect(messages[2]?.noticeSource).toBe('mid-run-todo-nudge');
  });

  test('folds a later toolResult entry into the assistant tool call and marks it errored', async () => {
    const messages = await loadSessionMessages(writeSession([
      { type: 'message', id: 'a1', timestamp: at(1), message: { role: 'assistant', content: [{ type: 'toolCall', id: 'c1', name: 'bash', arguments: { command: 'ls' } }] } },
      { type: 'message', id: 'r1', timestamp: at(2), message: { role: 'toolResult', toolCallId: 'c1', content: [{ type: 'text', text: 'file.txt' }] } },
      { type: 'message', id: 'r2', timestamp: at(3), message: { role: 'toolResult', toolCallId: 'c1', content: [{ type: 'text', text: 'more' }], isError: true } },
    ]));
    expect(messages).toHaveLength(1);
    expect(messages[0]?.toolCalls?.[0]?.output).toBe('file.txt\nmore');
    expect(messages[0]?.toolCalls?.[0]?.status).toBe('error');
  });

  test('reconstructs a user bubble from a skill-prompt entry, which stores no user message', async () => {
    const messages = await loadSessionMessages(writeSession([
      { type: 'custom_message', id: 'sk', customType: 'skill-prompt', timestamp: at(1), content: 'User invoked the "red-engineer" skill', details: { name: 'red-engineer' } },
      { type: 'custom_message', id: 'sk2', customType: 'skill-prompt', timestamp: at(2), content: 'no skill name here' },
    ]));
    expect(messages[0]?.role).toBe('user');
    expect(messages[0]?.content).toBe('/skill:red-engineer');
    // With no recoverable name it degrades to a notice rather than vanishing.
    expect(messages[1]?.notice).toBe('no skill name here');
  });
});
