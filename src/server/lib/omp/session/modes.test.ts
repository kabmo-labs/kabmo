/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The persisted mode reader.
 *
 * It is what makes a reload honest: the composer's toggles are restored from
 * the session's own JSONL, not from a client cache, so a session reopened in
 * another tab — or driven by the CLI — shows the modes it is actually in. The
 * rules below are the ones a naive "last entry wins" read gets wrong.
 */

import { describe, expect, test } from 'bun:test';
import { readPersistedModes } from '@/server/lib/omp/session/modes';

const line = (customType: string, data: unknown) => JSON.stringify({ type: 'custom', customType, data });

describe('readPersistedModes', () => {
  test('reads the pre-rename entry types too', () => {
    // A session written before the rename carries `chamber-*`. Both are a
    // transition log, and refusing the old ones would lose the mode state of
    // every session that existed at the upgrade.
    const body = [
      line('chamber-plan-state', { enabled: true }),
      line('chamber-goal-state', { enabled: true, goal: { id: 'g1', objective: 'ship', status: 'active' } }),
    ].join('\n');
    const modes = readPersistedModes(body);
    expect(modes.plan).toBe(true);
    expect(modes.goalRecord?.id).toBe('g1');
  });

  test('reports nothing for a session with no mode entries', () => {
    const body = JSON.stringify({ type: 'message', message: { role: 'user', content: 'hi' } });
    expect(readPersistedModes(body)).toEqual({
      plan: false,
      goal: false,
      goalLive: false,
      goalRecord: null,
      goalContinuation: null,
      goalMaxTurns: null,
    });
  });

  test('takes the LAST transition, not the first', () => {
    const body = [line('kabmo-plan-state', { enabled: true }), line('kabmo-plan-state', { enabled: false })].join('\n');
    expect(readPersistedModes(body).plan).toBe(false);
  });

  test('goalLive is true only for an ACTIVE goal', () => {
    // The distinction that decides whether a cold spawn arms the continuation
    // loop: a paused goal exists (the toggle reads as on) but is not being
    // pursued, and omp's own cold-start pause must not be overridden.
    const active = line('kabmo-goal-state', {
      enabled: true,
      goal: { id: 'g1', objective: 'x', status: 'active', tokensUsed: 0, timeUsedSeconds: 0, createdAt: 0, updatedAt: 0 },
    });
    const paused = line('kabmo-goal-state', {
      enabled: true,
      goal: { id: 'g1', objective: 'x', status: 'paused', tokensUsed: 0, timeUsedSeconds: 0, createdAt: 0, updatedAt: 0 },
    });
    expect(readPersistedModes(active).goalLive).toBe(true);
    expect(readPersistedModes(paused).goalLive).toBe(false);
    expect(readPersistedModes(paused).goal).toBe(true);
  });

  test('keeps a goal live across paused and budget-limited', () => {
    for (const status of ['active', 'paused', 'budget-limited'] as const) {
      const body = line('kabmo-goal-state', {
        enabled: true,
        goal: { id: 'g1', objective: 'x', status, tokensUsed: 0, timeUsedSeconds: 0, createdAt: 0, updatedAt: 0 },
      });
      expect(readPersistedModes(body).goal).toBe(true);
    }
  });

  test('a completed or dropped goal does not read as on', () => {
    for (const status of ['complete', 'dropped'] as const) {
      const body = line('kabmo-goal-state', {
        enabled: false,
        goal: { id: 'g1', objective: 'x', status, tokensUsed: 0, timeUsedSeconds: 0, createdAt: 0, updatedAt: 0 },
      });
      const parsed = readPersistedModes(body);
      expect(parsed.goal).toBe(false);
      // The record survives: the composer shows what the goal WAS.
      expect(parsed.goalRecord?.status).toBe(status);
    }
  });

  test('an enabled flag without a live status is not enough', () => {
    // omp writes `enabled: true` with `mode: "exiting"` on completion; the
    // status is what decides.
    const body = line('kabmo-goal-state', {
      enabled: true,
      goal: { id: 'g1', objective: 'x', status: 'complete', tokensUsed: 1, timeUsedSeconds: 1, createdAt: 0, updatedAt: 0 },
    });
    expect(readPersistedModes(body).goal).toBe(false);
  });

  test('ignores a malformed line rather than throwing', () => {
    const body = ['{not json', line('kabmo-plan-state', { enabled: true })].join('\n');
    expect(readPersistedModes(body).plan).toBe(true);
  });

  test('a loop verdict is read back, and only an entry that CARRIES it speaks', () => {
    // The count lives in the child's memory, so this entry is the only way a
    // reload learns the loop stood down. Everything after it is a goal
    // transition (`goal_updated` on each token update) with nothing to say
    // about the loop — treating that silence as "no verdict" would erase it.
    const goal = { id: 'g1', objective: 'x', status: 'active', tokensUsed: 9, timeUsedSeconds: 3, createdAt: 0, updatedAt: 0 };
    const body = [
      line('kabmo-goal-state', { enabled: true, goal, continuation: { turn: 3, maxTurns: 3, stopped: 'max-turns' } }),
      line('kabmo-goal-state', { enabled: true, goal }),
    ].join('\n');
    expect(readPersistedModes(body).goalContinuation).toEqual({ turn: 3, maxTurns: 3, stopped: 'max-turns' });
  });

  test('an explicit null clears the verdict the way a Resume does', () => {
    const goal = { id: 'g1', objective: 'x', status: 'paused', tokensUsed: 9, timeUsedSeconds: 3, createdAt: 0, updatedAt: 0 };
    const body = [
      line('kabmo-goal-state', { enabled: true, goal, continuation: { turn: 3, maxTurns: 3, stopped: 'budget' } }),
      line('kabmo-goal-state', { enabled: true, goal, continuation: null }),
    ].join('\n');
    expect(readPersistedModes(body).goalContinuation).toBeNull();
  });

  test('a malformed verdict is dropped rather than rendered', () => {
    const goal = { id: 'g1', objective: 'x', status: 'active', tokensUsed: 1, timeUsedSeconds: 1, createdAt: 0, updatedAt: 0 };
    const body = line('kabmo-goal-state', { enabled: true, goal, continuation: { turn: 0, maxTurns: 3 } });
    expect(readPersistedModes(body).goalContinuation).toBeNull();
  });

  test('the goal\'s own turn ceiling rides the verdict and survives Resume', () => {
    const goal = { id: 'g1', objective: 'x', status: 'active', tokensUsed: 1, timeUsedSeconds: 1, createdAt: 0, updatedAt: 0 };
    const body = [
      line('kabmo-goal-state', { enabled: true, goal, continuation: { turn: 2, maxTurns: 5 }, maxTurns: 5 }),
      // Resume clears the VERDICT; the ceiling must not go with it, or the goal
      // would silently fall back to the install default after a resume.
      line('kabmo-goal-state', { enabled: true, goal, continuation: null }),
    ].join('\n');
    const parsed = readPersistedModes(body);
    expect(parsed.goalContinuation).toBeNull();
    expect(parsed.goalMaxTurns).toBe(5);
  });
});
