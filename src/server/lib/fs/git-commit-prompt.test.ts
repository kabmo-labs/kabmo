/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, test } from 'bun:test';
import { buildCommitMessagePrompt, cleanCommitMessage } from '@/server/lib/fs/git-commit-prompt';
import type { CommitContext } from '@/server/lib/fs/git-commit-context';

const CONTEXT: CommitContext = {
  branch: 'feat/commit-message',
  files: ['src/a.ts', 'src/b.ts'],
  diff: 'diff --git a/src/a.ts b/src/a.ts\n+export const a = 1;',
  recentCommits: ['feat: add a', 'fix: correct b'],
  truncated: false,
  amend: false,
};

describe('buildCommitMessagePrompt', () => {
  test('carries the branch, the recent style, the files and the diff', () => {
    const prompt = buildCommitMessagePrompt(CONTEXT);
    expect(prompt).toContain('Branch: feat/commit-message');
    expect(prompt).toContain('- feat: add a');
    expect(prompt).toContain('- src/a.ts');
    expect(prompt).toContain('+export const a = 1;');
  });

  test('names the staged set as the commit scope', () => {
    expect(buildCommitMessagePrompt(CONTEXT)).toContain('the staged change set');
    expect(buildCommitMessagePrompt({ ...CONTEXT, amend: true })).toContain('the commit being amended');
  });

  test('says when the diff was truncated', () => {
    expect(buildCommitMessagePrompt({ ...CONTEXT, truncated: true })).toContain('truncated');
    expect(buildCommitMessagePrompt(CONTEXT)).not.toContain('truncated');
  });

  test('an empty history and an empty diff still produce a prompt', () => {
    const prompt = buildCommitMessagePrompt({
      ...CONTEXT,
      files: [],
      diff: '',
      recentCommits: [],
    });
    expect(prompt).toContain('(no commits yet)');
    expect(prompt).toContain('(no textual diff)');
  });

  test('a custom template replaces the built-in one', () => {
    const prompt = buildCommitMessagePrompt(CONTEXT, 'CUSTOM MARKER\n\n{{diff}}');
    expect(prompt).toContain('CUSTOM MARKER');
    expect(prompt).toContain('+export const a = 1;');
    expect(prompt).not.toContain('You write git commit messages');
  });
});

describe('cleanCommitMessage', () => {
  test('strips a code fence', () => {
    expect(cleanCommitMessage('```text\nfeat: add a\n```')).toBe('feat: add a');
  });

  test('strips a leading label', () => {
    expect(cleanCommitMessage('Commit message: fix: correct b')).toBe('fix: correct b');
  });

  test('keeps a multi-line body', () => {
    expect(cleanCommitMessage('feat: add a\n\nWhy it matters.')).toBe('feat: add a\n\nWhy it matters.');
  });
});
