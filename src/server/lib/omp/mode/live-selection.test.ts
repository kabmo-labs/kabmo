/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The live-child mode read, and the rule that decides when it speaks.
 *
 * This exists because a new chat is ALIVE before it has a transcript: omp
 * writes the JSONL at the first assistant message (measured: 40 s after the id
 * was adopted), and the file-based read answered 404 in the meantime — which the
 * composer treats as "no modes" and uses to reset the toggles the user just
 * pressed. The child's own mirror and its spawn environment are the only two
 * sources that describe it in that window, and the mirror wins where it has
 * spoken because a toggle moves the child without re-spawning it.
 *
 * A wrapper that has said nothing returns null, so the route keeps its own
 * answer instead of inventing an empty selection.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { liveModeSelection } from '@/server/lib/omp/mode/live-selection';
import { ModeMirror } from '@/server/lib/omp/rpc/mode-mirror';
import { recordSpawnProvenance } from '@/server/lib/omp/rpc/spawn-provenance';

const SESSION = 'sess-1';

interface FakeWrapper {
  modeMirror: ModeMirror;
  isAlive(): boolean;
}

/** Register a fake wrapper the way the registry holds a real one: the mode read
 *  goes through `getRpcSession` and the spawn env through the provenance map,
 *  both keyed by the wrapper object itself. */
function register(wrapper: FakeWrapper): FakeWrapper {
  globalThis.__ompSessions ??= new Map();
  globalThis.__ompSessions.set(SESSION, wrapper as never);
  return wrapper;
}

function makeWrapper(alive = true): FakeWrapper {
  return { modeMirror: new ModeMirror(), isAlive: () => alive };
}

afterEach(() => {
  globalThis.__ompSessions?.delete(SESSION);
  delete globalThis.__ompSessions;
});

describe('liveModeSelection', () => {
  test('no live child is null, so the caller keeps its own answer', () => {
    expect(liveModeSelection(SESSION)).toBeNull();
    register(makeWrapper(false));
    expect(liveModeSelection(SESSION)).toBeNull();
  });

  test('a child that has reported nothing is described by its spawn environment', () => {
    const wrapper = register(makeWrapper());
    recordSpawnProvenance(wrapper as never, 'yolo', { CHAMBER_MODES: 'plan' });

    const live = liveModeSelection(SESSION);
    expect(live?.spoken).toBe(false);
    expect(live?.modes.plan).toBe(true);
    expect(live?.modes.goal).toBe(false);
    expect(live?.modes.goalRecord).toBeNull();
  });

  test('a marker makes the child speak, and overrides the spawn environment', () => {
    const wrapper = register(makeWrapper());
    recordSpawnProvenance(wrapper as never, 'yolo', { CHAMBER_MODES: 'plan' });
    wrapper.modeMirror.observeMarker({ marker: 'CHAMBER_PLAN_STATE:' as never, payload: { enabled: false } });

    const live = liveModeSelection(SESSION);
    expect(live?.spoken).toBe(true);
    expect(live?.modes.plan).toBe(false);
  });

  test('a goal marker alone counts as the child having spoken', () => {
    const wrapper = register(makeWrapper());
    wrapper.modeMirror.observeMarker({
      marker: 'CHAMBER_GOAL_STATE:' as never,
      payload: {
        enabled: true,
        goal: { id: 'g1', objective: 'ship it', status: 'active', tokensUsed: 0, timeUsedSeconds: 0, createdAt: 0, updatedAt: 0 },
        continuation: { turn: 2, maxTurns: 25 },
        maxTurns: 25,
      },
    });

    const live = liveModeSelection(SESSION);
    expect(live?.spoken).toBe(true);
    expect(live?.modes.goal).toBe(true);
    expect(live?.modes.goalLive).toBe(true);
    expect(live?.modes.goalRecord?.objective).toBe('ship it');
    expect(live?.modes.goalContinuation).toEqual({ turn: 2, maxTurns: 25 });
    expect(live?.modes.goalMaxTurns).toBe(25);
  });

  test('a paused goal stays open but is not live', () => {
    const wrapper = register(makeWrapper());
    wrapper.modeMirror.observeMarker({
      marker: 'CHAMBER_GOAL_STATE:' as never,
      payload: {
        enabled: false,
        goal: { id: 'g1', objective: 'x', status: 'paused', tokensUsed: 0, timeUsedSeconds: 0, createdAt: 0, updatedAt: 0 },
      },
    });

    const live = liveModeSelection(SESSION);
    expect(live?.modes.goal).toBe(true);
    expect(live?.modes.goalLive).toBe(false);
  });

  // A goal the chat no longer owns keeps its record (the timeline's card shows
  // it) but must not re-open the composer's strip and button.
  test('a complete or dropped goal is off while its record still travels', () => {
    for (const status of ['complete', 'dropped'] as const) {
      const wrapper = register(makeWrapper());
      wrapper.modeMirror.observeMarker({
        marker: 'CHAMBER_GOAL_STATE:' as never,
        payload: {
          enabled: false,
          goal: { id: 'g1', objective: 'x', status, tokensUsed: 0, timeUsedSeconds: 0, createdAt: 0, updatedAt: 0 },
        },
      });

      const live = liveModeSelection(SESSION);
      expect(live?.modes.goal).toBe(false);
      expect(live?.modes.goalRecord?.status).toBe(status);
    }
  });
});
