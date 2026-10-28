/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import { afterAll, describe, expect, test } from 'bun:test';
import fs from 'fs';
import { join } from 'path';

import { loadSessionMessages } from '@/server/lib/omp/session/messages';
import { isNoticeRow } from '@/shared/lib/chat/notice-row';

const tempDirs: string[] = [];

/** Write a session JSONL whose lines are exactly the given records, in order. */
async function writeSession(lines: unknown[]): Promise<string> {
  const dir = await fs.promises.mkdtemp('omp-messages-');
  tempDirs.push(dir);
  const file = join(dir, 'session.jsonl');
  await Bun.write(file, `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`);
  return file;
}

afterAll(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});

const at = (second: number) => `2026-09-21T03:00:${String(second).padStart(2, '0')}.000Z`;

/** omp records harness notices as their own `custom_message` entry. */
const notice = (id: string, text: string, second: number) => ({
  type: 'custom_message',
  id,
  customType: 'ultrathink-notice',
  timestamp: at(second),
  content: [{ type: 'text', text: `<system-notice>${text}</system-notice>` }],
});

const turn = (id: string, role: 'user' | 'assistant', text: string, second: number) => ({
  type: 'message',
  id,
  timestamp: at(second),
  message: { role, content: [{ type: 'text', text }] },
});

describe('loadSessionMessages ordering', () => {
  test('returns entries in file order, leaving a notice before its following user turn', async () => {
    const file = await writeSession([
      notice('n1', 'Background job finished.', 0),
      turn('u1', 'user', 'halo', 1),
      turn('a1', 'assistant', 'hai', 2),
    ]);

    const messages = await loadSessionMessages(file);

    expect(messages.map((m) => m.id)).toEqual(['n1', 'u1', 'a1']);
    expect(messages[0].notice).toBe('Background job finished.');
    expect(messages[1]).toMatchObject({ role: 'user', content: 'halo' });
    expect(messages[2]).toMatchObject({ role: 'ai', content: 'hai' });
  });

  test('preserves a notice that sits between two turns', async () => {
    const file = await writeSession([
      turn('u1', 'user', 'satu', 0),
      turn('a1', 'assistant', 'dua', 1),
      notice('n1', 'Job done.', 2),
      turn('u2', 'user', 'tiga', 3),
      turn('a2', 'assistant', 'empat', 4),
    ]);

    expect((await loadSessionMessages(file)).map((m) => m.id)).toEqual(['u1', 'a1', 'n1', 'u2', 'a2']);
  });
});

describe('loadSessionMessages tool images', () => {
  test('carries a read result image onto the tool call that asked for it', async () => {
    // omp answers a `read` of an image with the picture itself, and the panel
    // cannot reach it any other way: the PATH is routinely outside the browse
    // scope (`/tmp/...`), so `/api/fs/raw` refuses it. The result entry is a
    // SEPARATE JSONL record from the assistant turn that emitted the call, so
    // the reload pass has to pair them by toolCallId.
    const file = await writeSession([
      {
        type: 'message',
        id: 'a1',
        timestamp: at(0),
        message: {
          role: 'assistant',
          content: [{ type: 'toolCall', id: 'c1', name: 'read', arguments: { path: '/tmp/shiki96.png' } }],
        },
      },
      {
        type: 'message',
        id: 'r1',
        timestamp: at(1),
        message: {
          role: 'toolResult',
          toolCallId: 'c1',
          toolName: 'read',
          content: [
            { type: 'text', text: 'Read image file [image/jpeg]' },
            { type: 'image', data: `blob:sha256:${'a'.repeat(64)}`, mimeType: 'image/jpeg' },
          ],
          details: { fileSize: 2640 },
        },
      },
    ]);

    const messages = await loadSessionMessages(file);
    const call = messages.find((m) => m.toolCalls?.length)?.toolCalls?.[0];

    expect(call?.images).toEqual([{ mimeType: 'image/jpeg', blobRef: `blob:sha256:${'a'.repeat(64)}` }]);
    expect(call?.output).toContain('Read image file');
  });

  test('an inline base64 image survives the reload', async () => {
    // A small image (or one written before the externalization threshold) stays
    // in the entry, and must reach the panel as bytes rather than be dropped
    // for lacking a blob ref.
    const file = await writeSession([
      {
        type: 'message',
        id: 'a1',
        timestamp: at(0),
        message: { role: 'assistant', content: [{ type: 'toolCall', id: 'c1', name: 'read', arguments: { path: '/tmp/x.png' } }] },
      },
      {
        type: 'message',
        id: 'r1',
        timestamp: at(1),
        message: {
          role: 'toolResult',
          toolCallId: 'c1',
          toolName: 'read',
          content: [{ type: 'image', data: 'QUJD', mimeType: 'image/png' }],
        },
      },
    ]);

    const call = (await loadSessionMessages(file)).find((m) => m.toolCalls?.length)?.toolCalls?.[0];
    expect(call?.images).toEqual([{ mimeType: 'image/png', dataBase64: 'QUJD' }]);
  });
});

describe('loadSessionMessages reminder classification', () => {
  const blocks = (id: string, texts: string[], second: number) => ({
    type: 'message',
    id,
    timestamp: at(second),
    message: { role: 'assistant', content: texts.map((text) => ({ type: 'text', text })), usage: { input: 1, output: 2 } },
  });

  test('prose that quotes the tag stays the answer', async () => {
    const prose = 'Chip shows the peeled tag (`system-reminder`).\n\nExample: <system-reminder>…</system-reminder> then free text.';
    const file = await writeSession([blocks('a1', [prose], 0)]);

    const [message] = await loadSessionMessages(file);

    expect(message.notice).toBeUndefined();
    expect(message.content).toBe(prose);
    expect(isNoticeRow(message)).toBe(false);
  });

  test('a text block that IS the reminder envelope becomes a notice', async () => {
    const file = await writeSession([blocks('a1', ['<system-reminder>\n10 todo items still open.\n</system-reminder>'], 0)]);

    const [message] = await loadSessionMessages(file);

    expect(message.content).toBe('');
    expect(message.notice).toBe('<system-reminder>\n10 todo items still open.\n</system-reminder>');
    expect(isNoticeRow(message)).toBe(true);
  });

  test('an envelope and prose in one turn split between notice and content', async () => {
    const file = await writeSession([blocks('a1', ['Jawaban akhir.', '<system-reminder>2 items open</system-reminder>'], 0)]);

    const [message] = await loadSessionMessages(file);

    expect(message.content).toBe('Jawaban akhir.');
    expect(message.notice).toBe('<system-reminder>2 items open</system-reminder>');
  });
});

describe('loadSessionMessages developer turns', () => {
  test('a developer-role nudge renders as a notice card, never assistant prose', async () => {
    const nudge = 'Tool call failed: your previous response tried to invoke a tool, but the tool-call markup was malformed, so it arrived as plain text, no tool was executed, and the broken markup was removed from your response.\n\nA tool call must be one complete envelope:\n\n```\n<｜DSML｜tool_calls>\n<｜DSML｜invoke name="TOOL_NAME">\n```';
    const file = await writeSession([
      {
        type: 'message',
        id: 'd1',
        timestamp: at(1),
        message: { role: 'developer', attribution: 'agent', content: [{ type: 'text', text: nudge }] },
      },
    ]);

    const [message] = await loadSessionMessages(file);

    expect(message.role).toBe('ai');
    expect(message.content).toBe('');
    expect(message.notice).toBe(nudge);
    expect(isNoticeRow(message)).toBe(true);
  });
});
