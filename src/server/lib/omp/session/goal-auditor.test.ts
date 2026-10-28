/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The goal progress check: the prompt the auditor is asked, the reply it must
 * give back, and the decision taken from it.
 *
 * The wording is the contract with the model, and the parsing is the contract
 * with the loop: a reply that cannot be read as three booleans must be null, so
 * the driver can stop rather than treat "I cannot tell" as "keep going".
 */

import { describe, expect, test } from 'bun:test';
import {
  buildGoalAuditPrompt,
  decideGoalProgress,
  readGoalAuditAnswers,
} from '@/server/lib/omp/session/goal-auditor.server';

const answers = (all_done: boolean, remaining: boolean, needs_user: boolean) => JSON.stringify({ all_done, remaining, needs_user });

describe('buildGoalAuditPrompt', () => {
  test('asks the three questions with the objective and the report', () => {
    const prompt = buildGoalAuditPrompt('Ship the exporter', 'I added the CSV path and the tests pass.');
    expect(prompt).toContain('all_done');
    expect(prompt).toContain('remaining');
    expect(prompt).toContain('needs_user');
    expect(prompt).toContain('<objective>\nShip the exporter\n</objective>');
    expect(prompt).toContain('I added the CSV path');
    // The reply format is stated, not implied.
    expect(prompt).toContain('{"all_done": boolean, "remaining": boolean, "needs_user": boolean}');
  });

  test('a long report keeps its opening and its close', () => {
    const answer = `${'a'.repeat(5_000)}MIDDLE${'z'.repeat(12_000)}`;
    const prompt = buildGoalAuditPrompt('objective', answer);
    expect(prompt).toContain('a'.repeat(100));
    expect(prompt).toContain('z'.repeat(100));
    expect(prompt).not.toContain('MIDDLE');
  });
});

describe('readGoalAuditAnswers', () => {
  test('reads the asked-for JSON, even wrapped in prose', () => {
    expect(readGoalAuditAnswers(`Here you go:\n${answers(true, false, false)}\n`)).toEqual({
      allDone: true,
      remaining: false,
      needsUser: false,
    });
  });

  test('anything that is not three booleans is not an answer', () => {
    expect(readGoalAuditAnswers('It looks done to me.')).toBeNull();
    expect(readGoalAuditAnswers('{"all_done": true}')).toBeNull();
    expect(readGoalAuditAnswers('{"all_done": "yes", "remaining": false, "needs_user": false}')).toBeNull();
    expect(readGoalAuditAnswers('{not json}')).toBeNull();
    expect(readGoalAuditAnswers('')).toBeNull();
  });
});

describe('decideGoalProgress', () => {
  test('blocked wins: a turn waiting on the user is not finished', () => {
    expect(decideGoalProgress({ allDone: true, remaining: false, needsUser: true })).toBe('blocked');
    expect(decideGoalProgress({ allDone: false, remaining: true, needsUser: true })).toBe('blocked');
  });

  test('complete needs all done AND nothing left for the agent', () => {
    expect(decideGoalProgress({ allDone: true, remaining: false, needsUser: false })).toBe('complete');
    // "done" while still naming work of its own is the narrowing the objective
    // forbids — keep going.
    expect(decideGoalProgress({ allDone: true, remaining: true, needsUser: false })).toBe('continue');
    expect(decideGoalProgress({ allDone: false, remaining: false, needsUser: false })).toBe('continue');
  });
});
