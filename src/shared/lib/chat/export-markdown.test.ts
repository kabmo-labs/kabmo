/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, test } from 'bun:test';
import type { ChatMessageData } from '@/shared/types';
import { sessionMarkdownFileName, sessionToMarkdown } from '@/shared/lib/chat/export-markdown';

const exportedAt = new Date('2026-11-17T10:00:00.000Z');

function message(overrides: Partial<ChatMessageData>): ChatMessageData {
  return { id: 'm1', role: 'user', content: '', ...overrides };
}

describe('sessionToMarkdown', () => {
  test('writes a header and both turns', () => {
    const markdown = sessionToMarkdown({
      id: 's1',
      title: 'Fix the parser',
      exportedAt,
      messages: [
        message({ id: 'u1', role: 'user', content: 'Why does it fail?' }),
        message({ id: 'a1', role: 'assistant', content: 'Because the token is empty.' }),
      ],
    });

    expect(markdown).toContain('# Fix the parser');
    expect(markdown).toContain('- **Session ID:** `s1`');
    expect(markdown).toContain('- **Exported:** 2026-11-17T10:00:00.000Z');
    expect(markdown).toContain('## User\n\nWhy does it fail?');
    expect(markdown).toContain('## Assistant\n\nBecause the token is empty.');
  });

  test('a notice is a blockquote, never an assistant answer', () => {
    const markdown = sessionToMarkdown({
      id: 's1',
      exportedAt,
      messages: [message({ role: 'assistant', notice: 'System reminder\nsecond line' })],
    });

    expect(markdown).toContain('## System notice');
    expect(markdown).toContain('> System reminder\n> second line');
    expect(markdown).not.toContain('## Assistant');
  });

  test('a tool call keeps its command and output fenced', () => {
    const markdown = sessionToMarkdown({
      id: 's1',
      exportedAt,
      messages: [
        message({
          role: 'assistant',
          content: 'Running the tests.',
          toolCalls: [
            {
              id: 't1',
              type: 'bash',
              title: 'Run tests',
              command: 'bun test',
              output: 'pass',
              status: 'success',
            },
          ],
        }),
      ],
    });

    expect(markdown).toContain('**Tool: Run tests** — success');
    expect(markdown).toContain('```sh\nbun test\n```');
    expect(markdown).toContain('```\npass\n```');
  });

  test('a fence grows past backticks inside the output', () => {
    const markdown = sessionToMarkdown({
      id: 's1',
      exportedAt,
      messages: [
        message({
          role: 'assistant',
          toolCalls: [{ id: 't1', type: 'read', title: 'Read', output: '```js\nx\n```' }],
        }),
      ],
    });

    expect(markdown).toContain('````\n```js\nx\n```\n````');
  });

  test('thinking is a collapsed details block', () => {
    const markdown = sessionToMarkdown({
      id: 's1',
      exportedAt,
      messages: [message({ role: 'assistant', thinking: { thought: 'Check the token first.' } })],
    });

    expect(markdown).toContain('<details>');
    expect(markdown).toContain('<summary>Thinking</summary>');
    expect(markdown).toContain('Check the token first.');
  });
});

describe('sessionMarkdownFileName', () => {
  test('turns a title into a safe file name', () => {
    expect(sessionMarkdownFileName('Fix: parser / token?', 's1')).toBe('Fix-parser-token.md');
  });

  test('falls back to the id when the title is empty', () => {
    expect(sessionMarkdownFileName('   ', 's1')).toBe('session-s1.md');
  });
});
