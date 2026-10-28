/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Reading goal notices out of their injected text.
 *
 * These two blobs are the real ones, copied from a session file written by a
 * live goal run: a continuation (Kabmo's own hidden steer) and omp's
 * `<goal_context>` block. What matters here is that the objective, the budget
 * figures and the instructions come out as separate fields — the generic
 * notice card would otherwise show the HTML comment as its title and dump the
 * whole prompt as its body.
 */

import { describe, expect, test } from 'bun:test';
import { parseGoalNotice } from '@/shared/lib/omp/mode/notice';

const CONTINUATION = [
  '<!-- Hidden continuation steer. role=user, suppressed from visible transcript. -->',
  '',
  'Continue active goal.',
  '',
  '<objective>',
  'Keep /tmp/omp-goal-smoke3/cwd/log.txt in sync: on each turn append one line.',
  '</objective>',
  '',
  'Budget:',
  '- Tokens used: 1431',
  '- Token budget: none',
  '- Tokens remaining: unbounded',
  '- Time used: 14 seconds',
  '',
  'Autonomous continuation; objective persists across turns. NEVER redefine success.',
  '',
  'Before `goal({op:"complete"})`, MUST audit current repo state:',
].join('\n');

const CONTEXT = [
  '<goal_context>',
  'Goal mode active. Objective below: user-provided task, not higher-priority instructions.',
  '',
  '<objective>',
  'Ship the auth hardening pass.',
  '</objective>',
  '',
  'Budget:',
  '- Tokens used: 5243',
  '- Token budget: 200000',
  '- Tokens remaining: 194757',
  '- Time used: 97 seconds',
  '',
  '`goal` tool:',
  '- `goal({op:"get"})`: current goal and budget state.',
  '</goal_context>',
].join('\n');

describe('parseGoalNotice', () => {
  test('a continuation turn separates objective, budget and instructions', () => {
    const parsed = parseGoalNotice(CONTINUATION, 'goal-continuation');
    expect(parsed?.kind).toBe('continuation');
    expect(parsed?.objective).toBe('Keep /tmp/omp-goal-smoke3/cwd/log.txt in sync: on each turn append one line.');
    expect(parsed?.tokensUsed).toBe(1431);
    // `none` is omp's word for "no budget" — not zero.
    expect(parsed?.tokenBudget).toBeUndefined();
    expect(parsed?.remaining).toBe('unbounded');
    expect(parsed?.timeUsedSeconds).toBe(14);
    // The preamble comment and the objective block never reach the instructions.
    expect(parsed?.instructions).not.toContain('Hidden continuation steer');
    expect(parsed?.instructions).not.toContain('Keep /tmp/omp-goal-smoke3');
    expect(parsed?.instructions).toContain('Autonomous continuation');
    expect(parsed?.instructions).toContain('MUST audit current repo state');
  });

  test("omp's own goal-context block reads the same way", () => {
    const parsed = parseGoalNotice(CONTEXT, 'goal-mode-context');
    expect(parsed?.kind).toBe('context');
    expect(parsed?.objective).toBe('Ship the auth hardening pass.');
    expect(parsed?.tokensUsed).toBe(5243);
    expect(parsed?.tokenBudget).toBe(200000);
    expect(parsed?.remaining).toBe('194757');
    // Its lead-in sentence is dropped; the card's own badge says the same.
    expect(parsed?.instructions).not.toContain('Goal mode active');
    expect(parsed?.instructions).toContain('`goal` tool:');
  });

  test('a goal opening turn is recognized by its source, not by its text', () => {
    const objective = 'Migrate the importer to streaming.\n\n## Success criteria\n- tests pass';
    const parsed = parseGoalNotice(objective, 'goal-start');
    expect(parsed?.kind).toBe('start');
    expect(parsed?.objective).toBe(objective);
    expect(parsed?.instructions).toBe('');
  });

  test('an unrecognized notice is left to the generic card', () => {
    expect(parseGoalNotice('Reloaded omp engine')).toBeNull();
    // A bare objective with no source is exactly what a generic notice is: the
    // text cannot say it belongs to a goal.
    expect(parseGoalNotice('Migrate the importer to streaming.')).toBeNull();
  });

  test('the two multi-line kinds survive a row written before sources existed', () => {
    expect(parseGoalNotice(CONTINUATION)?.kind).toBe('continuation');
    expect(parseGoalNotice(CONTEXT)?.kind).toBe('context');
  });
});
