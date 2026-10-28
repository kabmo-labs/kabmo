/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The wrapper's goal mirror.
 *
 * `get_state` does not carry goal mode, so this mirror is the only thing the
 * agent-state route can report a reattaching client. It is fed by omp's own
 * `goal_updated`, which is authoritative — and the rule that matters is which
 * STATUSES count as live, because the answer decides whether the composer's
 * toggle reads as on.
 */

import { describe, expect, test } from 'bun:test';
import { ModeMirror } from '@/server/lib/omp/rpc/mode-mirror';
import type { GoalStatus } from '@/shared/lib/omp/mode/types';

function frame(status: GoalStatus, enabled = true) {
  return { type: 'goal_updated', goal: { id: 'g1', objective: 'x', status }, state: { enabled, goal: { id: 'g1', objective: 'x', status } } };
}

function goal(status: GoalStatus) {
  return { id: 'g1', objective: 'x', status, tokensUsed: 0, timeUsedSeconds: 0, createdAt: 0, updatedAt: 0 };
}

describe('ModeMirror', () => {
  test('active and budget-limited are live', () => {
    const live: GoalStatus[] = ['active', 'budget-limited'];
    for (const status of live) {
      const mirror = new ModeMirror();
      mirror.observe(frame(status));
      expect(mirror.goalEnabled).toBe(true);
      expect(mirror.goalStatus).toBe(status);
    }
  });

  test('paused, complete and dropped are not live', () => {
    const closed: GoalStatus[] = ['paused', 'complete', 'dropped'];
    for (const status of closed) {
      const mirror = new ModeMirror();
      mirror.observe(frame(status));
      expect(mirror.goalEnabled).toBe(false);
      // The status is still recorded: the card and the modal show what the goal
      // WAS, which a bare boolean could not.
      expect(mirror.goalStatus).toBe(status);
    }
  });

  test('enabled:false wins even for an active status', () => {
    const mirror = new ModeMirror();
    mirror.observe(frame('active', false));
    expect(mirror.goalEnabled).toBe(false);
  });

  test('reads the status from the top-level goal when no state is present', () => {
    const mirror = new ModeMirror();
    mirror.observe({ type: 'goal_updated', goal: { id: 'g1', objective: 'x', status: 'active' } });
    expect(mirror.goalEnabled).toBe(false); // no `state.enabled`, so not live
    expect(mirror.goalStatus).toBe('active');
  });

  test('a null goal clears the status', () => {
    const mirror = new ModeMirror();
    mirror.observe(frame('active'));
    mirror.observe({ type: 'goal_updated', goal: null });
    expect(mirror.goalEnabled).toBe(false);
    expect(mirror.goalStatus).toBeUndefined();
  });
});

/**
 * The marker feed: the extension's own `CHAMBER_*` notices.
 *
 * This half exists because a new chat has no transcript for the first
 * seconds-to-minutes of its life (omp writes the JSONL at the first assistant
 * message), while the child is already in whatever mode the user picked — and
 * because PLAN mode has no omp event at all, so the extension's marker is the
 * only live word on it.
 */
describe('ModeMirror.observeMarker', () => {
  const marker = (name: string, payload: Record<string, unknown>) => ({ marker: name as never, payload });

  test('the pre-rename spelling is still observed', () => {
    // A transcript replayed from before the rename carries `CHAMBER_*`; the
    // mirror is what a reattaching client reads the mode from, so ignoring the
    // old prefix would show a session as having no mode at all.
    const mirror = new ModeMirror();
    mirror.observeMarker(marker('CHAMBER_PLAN_STATE:', { enabled: true }));
    expect(mirror.planEnabled).toBe(true);
    mirror.observeMarker(marker('CHAMBER_GOAL_STATE:', { goal: goal('active'), enabled: true }));
    expect(mirror.goalRecord?.id).toBe('g1');
  });

  test('a plan marker sets the flag in both directions', () => {
    const mirror = new ModeMirror();
    expect(mirror.planEnabled).toBeUndefined();
    mirror.observeMarker(marker('KABMO_PLAN_STATE:', { enabled: true }));
    expect(mirror.planEnabled).toBe(true);
    mirror.observeMarker(marker('KABMO_PLAN_STATE:', { enabled: false }));
    expect(mirror.planEnabled).toBe(false);
  });

  test('a goal marker records the record and applies the live rule', () => {
    const mirror = new ModeMirror();
    mirror.observeMarker(marker('KABMO_GOAL_STATE:', { goal: goal('active'), enabled: true }));
    expect(mirror.goalRecord?.id).toBe('g1');
    expect(mirror.goalStatus).toBe('active');
    expect(mirror.goalEnabled).toBe(true);

    // Paused: the record stays (the composer still shows the goal) but it is
    // not work in progress.
    mirror.observeMarker(marker('KABMO_GOAL_STATE:', { goal: goal('paused'), enabled: false }));
    expect(mirror.goalRecord?.status).toBe('paused');
    expect(mirror.goalEnabled).toBe(false);
  });

  test('a continuation verdict and its ceiling ride the goal marker', () => {
    const mirror = new ModeMirror();
    mirror.observeMarker(
      marker('KABMO_GOAL_STATE:', { goal: goal('active'), enabled: true, continuation: { turn: 3, maxTurns: 25 }, maxTurns: 25 }),
    );
    expect(mirror.goalContinuation).toEqual({ turn: 3, maxTurns: 25 });
    expect(mirror.goalMaxTurns).toBe(25);

    // A transition entry with no verdict must not erase the last one.
    mirror.observeMarker(marker('KABMO_GOAL_STATE:', { goal: goal('active'), enabled: true }));
    expect(mirror.goalContinuation).toEqual({ turn: 3, maxTurns: 25 });
  });

  test('a plan marker leaves the goal record alone', () => {
    const mirror = new ModeMirror();
    mirror.observeMarker(marker('KABMO_GOAL_STATE:', { goal: goal('active'), enabled: true }));
    mirror.observeMarker(marker('KABMO_PLAN_STATE:', { enabled: true }));
    expect(mirror.goalRecord?.id).toBe('g1');
    expect(mirror.goalEnabled).toBe(true);
  });

  test('a refusal and a proposal are not a selection', () => {
    const mirror = new ModeMirror();
    mirror.observeMarker(marker('CHAMBER_MODE_ERROR:', { scope: 'plan', reason: 'nope' }));
    mirror.observeMarker(marker('CHAMBER_PLAN_PROPOSAL:', { title: 'x' }));
    expect(mirror.planEnabled).toBeUndefined();
    expect(mirror.goalRecord).toBeNull();
  });

  // A status this build does not know is a version skew, not an open goal: it
  // is dropped rather than stored, so no downstream `isGoalOpen` has to cast.
  test('an unknown goal status is not recorded as one', () => {
    const mirror = new ModeMirror();
    mirror.observe({ type: 'goal_updated', goal: { status: 'invented' }, state: { enabled: true, goal: { status: 'invented' } } });
    expect(mirror.goalStatus).toBeUndefined();
    expect(mirror.goalEnabled).toBe(false);
  });
});
