/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_COMMIT_MESSAGE_PROMPT,
  renderCommitPrompt,
  validateCommitPrompt,
} from '@/shared/lib/git/commit-prompt';

const VALUES = {
  scope: 'the staged change set',
  branch: 'main',
  recent_commits: '- base',
  files: '- a.ts',
  diff: '+a',
  truncated: '',
};

describe('renderCommitPrompt', () => {
  test('fills every known placeholder', () => {
    const rendered = renderCommitPrompt('{{branch}} {{diff}} {{files}}', VALUES);
    expect(rendered).toBe('main +a - a.ts');
  });

  test('leaves an unknown placeholder visible', () => {
    expect(renderCommitPrompt('{{branch}} {{nope}}', VALUES)).toBe('main {{nope}}');
  });

  test('a diff containing $ is inserted verbatim', () => {
    expect(renderCommitPrompt('{{diff}}', { ...VALUES, diff: '+cost = $5' })).toBe('+cost = $5');
  });
});

describe('validateCommitPrompt', () => {
  test('the built-in prompt is valid', () => {
    expect(validateCommitPrompt(DEFAULT_COMMIT_MESSAGE_PROMPT).ok).toBe(true);
  });

  test('a prompt without the diff is refused', () => {
    const result = validateCommitPrompt('Write a message from {{files}}.');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('{{diff}}');
  });
});
