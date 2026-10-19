/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The client's marker handlers must accept BOTH spellings.
 *
 * The extension emits `KABMO_*` prefixes now, and a transcript replayed from
 * before the rename carries `CHAMBER_*`. A handler that tests a literal string
 * recognizes exactly one of them; the other still PARSES (it is not prose), so
 * nothing errors — it simply moves nothing. The measured shape of that failure:
 * a goal record never reaches the strip and a plan review never opens, with no
 * message anywhere to explain it.
 */

import { describe, expect, test } from 'bun:test';
import { goalMarkerPatch } from '@/client/hooks/chat/timeline/mode-markers';
import { isModeMarker } from '@/shared/lib/omp/mode/constants';
import { parseModeMarker } from '@/shared/lib/omp/mode/markers';

function parsed(marker: string, payload = '{"enabled":true}') {
  const value = parseModeMarker(`${marker}${payload}`);
  if (!value) throw new Error(`marker did not parse: ${marker}`);
  return value;
}

describe('marker spellings', () => {
  test('a goal state marker moves the record under either prefix', () => {
    for (const prefix of ['KABMO_GOAL_STATE:', 'CHAMBER_GOAL_STATE:']) {
      const patch = goalMarkerPatch(parsed(prefix), null);
      expect(patch).not.toBeNull();
      expect(patch?.enabled).toBe(true);
    }
  });

  test('a continuation marker is recognized under either prefix', () => {
    for (const prefix of ['KABMO_GOAL_CONTINUATION:', 'CHAMBER_GOAL_CONTINUATION:']) {
      const patch = goalMarkerPatch(parsed(prefix, '{"turn":2,"maxTurns":25}'), null);
      expect(patch?.continuation?.turn).toBe(2);
      expect(patch?.evaluating).toBe(false);
    }
  });

  test('the plan and error names match under either spelling', () => {
    expect(isModeMarker('KABMO_PLAN_PROPOSAL:', 'planProposalMarker')).toBe(true);
    expect(isModeMarker('CHAMBER_PLAN_PROPOSAL:', 'planProposalMarker')).toBe(true);
    expect(isModeMarker('KABMO_MODE_ERROR:', 'modeErrorMarker')).toBe(true);
    expect(isModeMarker('CHAMBER_MODE_ERROR:', 'modeErrorMarker')).toBe(true);
    // A different marker of the same scope is NOT this one.
    expect(isModeMarker('KABMO_PLAN_STATE:', 'planProposalMarker')).toBe(false);
  });

  test('a marker of another scope moves no goal field', () => {
    expect(goalMarkerPatch(parsed('KABMO_MODE_ERROR:', '{"reason":"no"}'), null)).toBeNull();
  });
});
