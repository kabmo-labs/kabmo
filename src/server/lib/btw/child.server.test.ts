/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The side child's argv.
 *
 * `--no-tools` is the parity contract: omp's own `/btw` runs the side turn with
 * the tool catalog attached only for prompt-cache warmth and DISCARDS any tool
 * call, so a child here that could execute one would be answering a different
 * question. `--approval-mode` is deliberately absent — with no tool surface it
 * would govern nothing.
 */

import { describe, expect, test } from 'bun:test';
import { buildBtwSpawnArgs } from '@/server/lib/btw/child.server';
import { buildBtwPrompt } from '@/server/lib/btw/prompt';

describe('buildBtwSpawnArgs', () => {
  test('resumes the transcript without tools or a title', () => {
    expect(buildBtwSpawnArgs('/tmp/topic.jsonl', {})).toEqual([
      '--resume',
      '/tmp/topic.jsonl',
      '--no-title',
      '--no-tools',
    ]);
  });

  test('carries the chat model and thinking selector', () => {
    expect(buildBtwSpawnArgs('/tmp/topic.jsonl', {
      model: { provider: 'kenari', id: 'deepseek-v4' },
      thinkingLevel: 'high',
    })).toEqual([
      '--resume',
      '/tmp/topic.jsonl',
      '--no-title',
      '--no-tools',
      '--model',
      'kenari/deepseek-v4',
      '--thinking',
      'high',
    ]);
  });

  test('passes auto through rather than dropping it', () => {
    expect(buildBtwSpawnArgs('/tmp/topic.jsonl', { thinkingLevel: 'auto' })).toContain('auto');
  });

  test('never passes an approval mode', () => {
    expect(buildBtwSpawnArgs('/tmp/topic.jsonl', { model: { provider: 'p', id: 'm' } })).not.toContain('--approval-mode');
  });
});

describe('buildBtwPrompt', () => {
  test("is omp's own template, tool prohibition included", () => {
    expect(buildBtwPrompt('what is this?')).toBe([
      '<btw>',
      'Ephemeral side question for current interactive session.',
      'Answer briefly, directly; use conversation context already provided.',
      'NEVER use tools.',
      'NEVER ask follow-up questions.',
      'Question:',
      'what is this?',
      '</btw>',
    ].join('\n'));
  });
});
