/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The spawn-time system prompt a stage asks for.
 *
 * Two rules are load-bearing and each was a silent failure before the plumbing
 * existed: omp can only take the prompt at SPAWN (so the request has to carry
 * it), and ACP has no field for it at all (so the prompt has to ride the first
 * turn, delimited). Both are asserted here, plus the refusals that keep an
 * over-long argv and a comma-split glob from reaching a child.
 */

import { describe, expect, test } from 'bun:test';
import {
  MAX_SKILL_GLOBS,
  MAX_SYSTEM_PROMPT_CHARS,
  readSpawnPrompt,
  withSystemPrompt,
} from '@/server/routes/agent/new';

describe('readSpawnPrompt', () => {
  test('a trimmed prompt and its globs survive', () => {
    expect(readSpawnPrompt({ systemPrompt: '  Work the card.  ', skills: ['review-*', ' pr-* '] })).toEqual({
      ok: true,
      prompt: { systemPrompt: 'Work the card.', skills: ['review-*', 'pr-*'] },
    });
  });

  test('nothing asked for is an empty snapshot, not a refusal', () => {
    expect(readSpawnPrompt({})).toEqual({ ok: true, prompt: {} });
    expect(readSpawnPrompt({ systemPrompt: '   ', skills: [] })).toEqual({ ok: true, prompt: {} });
    expect(readSpawnPrompt({ skills: ['', '  '] })).toEqual({ ok: true, prompt: {} });
  });

  test('a non-string prompt is refused by name', () => {
    expect(readSpawnPrompt({ systemPrompt: 42 })).toEqual({ ok: false, error: 'systemPrompt must be a string' });
  });

  test('an over-long prompt is refused rather than truncated', () => {
    // Truncating would silently drop the half of the instructions that came
    // last, which is exactly where a stage puts "do not edit code".
    const long = 'x'.repeat(MAX_SYSTEM_PROMPT_CHARS + 1);
    expect(readSpawnPrompt({ systemPrompt: long }).ok).toBe(false);
    expect(readSpawnPrompt({ systemPrompt: 'x'.repeat(MAX_SYSTEM_PROMPT_CHARS) }).ok).toBe(true);
  });

  test('a glob with a comma is refused: the flag is a comma-separated list', () => {
    expect(readSpawnPrompt({ skills: ['a,b'] })).toEqual({
      ok: false,
      error: 'a skill glob may not contain a comma',
    });
  });

  test('the glob list is bounded', () => {
    const many = Array.from({ length: MAX_SKILL_GLOBS + 1 }, (_, index) => `s${index}-*`);
    expect(readSpawnPrompt({ skills: many }).ok).toBe(false);
    expect(readSpawnPrompt({ skills: many.slice(0, MAX_SKILL_GLOBS) }).ok).toBe(true);
  });

  test('a non-array skills field is refused', () => {
    expect(readSpawnPrompt({ skills: 'review-*' })).toEqual({
      ok: false,
      error: 'skills must be an array of globs',
    });
  });
});

describe('withSystemPrompt', () => {
  test('ACP gets the instructions in a delimited block above the task', () => {
    expect(withSystemPrompt('Review it.', 'Look at the diff.')).toBe(
      '<stage_instructions>\nReview it.\n</stage_instructions>\n\nLook at the diff.',
    );
  });

  test('no prompt leaves the message byte-identical', () => {
    expect(withSystemPrompt(undefined, 'Look at the diff.')).toBe('Look at the diff.');
  });
});
