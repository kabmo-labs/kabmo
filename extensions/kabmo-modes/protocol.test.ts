/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The extension keeps a second copy of the mode constants (it runs in the omp
 * child, outside Kabmo's module graph — see `protocol.ts`). This
 * test is what keeps the two from drifting: a constant or choice renamed on one
 * side fails here instead of producing a console and an agent that disagree
 * about the wire format.
 */

import { describe, expect, test } from 'bun:test';
import * as extension from './protocol';
import * as shared from '../../src/shared/lib/omp/mode/types';

const SHARED_KEYS = [
  'CHAMBER_GOAL_STATE_ENTRY',
  'CHAMBER_PLAN_STATE_ENTRY',
  'CHAMBER_MODE_COMMAND',
  'CHAMBER_MODES_ENV',
  'CHAMBER_PLAN_STATE_MARKER',
  'CHAMBER_GOAL_STATE_MARKER',
  'CHAMBER_MODE_STATE_MARKER',
  'CHAMBER_MODE_ERROR_MARKER',
  'CHAMBER_PLAN_PROPOSAL_MARKER',
  'CHAMBER_PLAN_DECISION_MARKER',
  'CHAMBER_PLAN_SAVED_MARKER',
  'CHAMBER_GOAL_CONTINUATION_MARKER',
  'CHAMBER_GOAL_EVALUATING_MARKER',
  'KABMO_GOAL_STATE_ENTRY',
  'KABMO_PLAN_STATE_ENTRY',
  'KABMO_MODE_COMMAND',
  'KABMO_MODES_ENV',
  'KABMO_PLAN_STATE_MARKER',
  'KABMO_GOAL_STATE_MARKER',
  'KABMO_MODE_STATE_MARKER',
  'KABMO_MODE_ERROR_MARKER',
  'KABMO_PLAN_PROPOSAL_MARKER',
  'KABMO_PLAN_DECISION_MARKER',
  'KABMO_PLAN_SAVED_MARKER',
  'KABMO_GOAL_CONTINUATION_MARKER',
  'KABMO_GOAL_EVALUATING_MARKER',
] as const;

describe('extension/shared mode constants', () => {
  for (const key of SHARED_KEYS) {
    test(`${key} agrees`, () => {
      expect(extension[key]).toBe(shared[key]);
    });
  }

  test('PLAN_REVIEW_CHOICES agrees, in order', () => {
    expect([...extension.PLAN_REVIEW_CHOICES]).toEqual([...shared.PLAN_REVIEW_CHOICES]);
  });
});
