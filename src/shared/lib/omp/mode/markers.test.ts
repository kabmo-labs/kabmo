/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The marker parser is the boundary between the extension (which writes) and
 * the composer (which reads). A marker that fails to parse must degrade to an
 * ordinary notice, never to silence: a version skew that swallowed the message
 * would leave the user with a toggle that does nothing and no explanation.
 */

import { describe, expect, test } from 'bun:test';
import { continuationFromMarker, goalEnabledFromMarker, goalRecordFromMarker, parseModeMarker } from '@/shared/lib/omp/mode/markers';
import {
  CHAMBER_GOAL_CONTINUATION_MARKER,
  CHAMBER_PLAN_STATE_MARKER,
  KABMO_GOAL_CONTINUATION_MARKER,
  KABMO_PLAN_STATE_MARKER,
} from '@/shared/lib/omp/mode/types';

describe('parseModeMarker', () => {
  test('parses the CURRENT spelling the extension emits', () => {
    // The write side moved to `KABMO_*`; a parser that only knew the old
    // prefixes would render every marker as a raw JSON notice.
    const parsed = parseModeMarker(`${KABMO_PLAN_STATE_MARKER}{"enabled":true}`);
    expect(parsed?.marker).toBe(KABMO_PLAN_STATE_MARKER);
    expect(parsed?.payload.enabled).toBe(true);
  });

  test('parses a continuation marker under both spellings', () => {
    expect(parseModeMarker(`${KABMO_GOAL_CONTINUATION_MARKER}{"turn":1,"maxTurns":25}`)?.marker)
      .toBe(KABMO_GOAL_CONTINUATION_MARKER);
    expect(parseModeMarker(`${CHAMBER_GOAL_CONTINUATION_MARKER}{"turn":1,"maxTurns":25}`)?.marker)
      .toBe(CHAMBER_GOAL_CONTINUATION_MARKER);
  });

  test('parses a plan-state marker', () => {
    const parsed = parseModeMarker(`${CHAMBER_PLAN_STATE_MARKER}{"enabled":true}`);
    expect(parsed?.marker).toBe(CHAMBER_PLAN_STATE_MARKER);
    expect(parsed?.payload.enabled).toBe(true);
  });

  test('an ordinary notice is not a marker', () => {
    expect(parseModeMarker('Reloaded omp engine')).toBeNull();
  });

  test('a marker with a broken payload is not a marker', () => {
    // Rendered as a notice instead: the alternative is a silent drop.
    expect(parseModeMarker(`${CHAMBER_PLAN_STATE_MARKER}{truncated`)).toBeNull();
  });

  test('a marker whose payload is not an object is not a marker', () => {
    expect(parseModeMarker(`${CHAMBER_PLAN_STATE_MARKER}"text"`)).toBeNull();
  });

  test('the longest marker wins', () => {
    // CHAMBER_PLAN_STATE: is a prefix of CHAMBER_PLAN_STATE_MARKER, so an
    // unordered table would resolve the longer one to the shorter.
    const parsed = parseModeMarker('CHAMBER_PLAN_PROPOSAL:{"title":"t","planFilePath":"local://t-plan.md"}');
    expect(parsed?.marker).toBe('CHAMBER_PLAN_PROPOSAL:');
    expect(parsed?.payload.title).toBe('t');
  });
});

describe('goal payload readers', () => {
  test('reads a well-formed record', () => {
    const record = { id: 'g1', objective: 'x', status: 'active', tokensUsed: 1, timeUsedSeconds: 1, createdAt: 0, updatedAt: 0 };
    expect(goalRecordFromMarker({ goal: record })?.id).toBe('g1');
    expect(goalEnabledFromMarker({ enabled: true })).toBe(true);
  });

  test('rejects a partial record rather than fabricating one', () => {
    expect(goalRecordFromMarker({ goal: { id: 'g1' } })).toBeNull();
    expect(goalRecordFromMarker({ goal: null })).toBeNull();
    expect(goalRecordFromMarker({})).toBeNull();
  });

  test('enabled is strict', () => {
    expect(goalEnabledFromMarker({ enabled: 'yes' })).toBe(false);
    expect(goalEnabledFromMarker({})).toBe(false);
  });
});

describe('goal continuation reader', () => {
  test('reads the turn the loop opened', () => {
    const parsed = parseModeMarker(`${CHAMBER_GOAL_CONTINUATION_MARKER}{"turn":3,"maxTurns":25}`);
    expect(parsed?.marker).toBe(CHAMBER_GOAL_CONTINUATION_MARKER);
    expect(continuationFromMarker(parsed!.payload)).toEqual({ turn: 3, maxTurns: 25 });
  });

  test('carries the stand-down reason out of the loop', () => {
    const parsed = parseModeMarker(
      `${CHAMBER_GOAL_CONTINUATION_MARKER}{"turn":25,"maxTurns":25,"stopped":"max-turns"}`,
    );
    expect(continuationFromMarker(parsed!.payload)?.stopped).toBe('max-turns');
  });

  test('a turn count that is not 1-based is refused rather than rendered', () => {
    // The child increments before it emits, so these are version skews — and a
    // strip reading "turn NaN of undefined" is worse than no strip.
    expect(continuationFromMarker({ turn: 0, maxTurns: 25 })).toBeNull();
    expect(continuationFromMarker({ turn: 1.5, maxTurns: 25 })).toBeNull();
    expect(continuationFromMarker({ turn: 3 })).toBeNull();
    expect(continuationFromMarker({})).toBeNull();
  });

  test('an unknown stand-down reason is dropped, not stringified', () => {
    expect(continuationFromMarker({ turn: 1, maxTurns: 2, stopped: 5 })).toEqual({ turn: 1, maxTurns: 2 });
  });
});
