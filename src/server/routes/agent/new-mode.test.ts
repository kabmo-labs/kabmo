/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Which ACP mode a brand-new chat starts in.
 *
 * Two spellings reach this route: the composer's own ladder pick (`sessionMode`,
 * the agent's vocabulary) and Kabmo's Plan flag (`modes.plan`, the omp toggle).
 * The ladder wins — it can name any mode the agent publishes, and `plan` is just
 * one of its values. A dropped mapping here starts the chat in the agent's
 * default while the composer's chip names the operator's pick.
 */

import { describe, expect, test } from 'bun:test';
import { harnessModeSelection } from '@/server/routes/agent/new';

describe('harnessModeSelection', () => {
  test("the composer's ladder pick is the mode", () => {
    expect(harnessModeSelection({ sessionMode: 'architect' })).toBe('architect');
  });

  test('the Plan flag maps to the plan mode when no ladder pick exists', () => {
    expect(harnessModeSelection({ modes: { plan: true, goal: false } })).toBe('plan');
    expect(harnessModeSelection({ modes: { plan: false, goal: true } })).toBeNull();
  });

  test('an explicit pick wins over the flag, and a blank pick does not', () => {
    expect(harnessModeSelection({ sessionMode: 'code', modes: { plan: true } })).toBe('code');
    // A blank string is not a choice: the flag still decides.
    expect(harnessModeSelection({ sessionMode: '  ', modes: { plan: true } })).toBe('plan');
  });

  test('a spawn with neither names no mode', () => {
    expect(harnessModeSelection({})).toBeNull();
    expect(harnessModeSelection({ modes: null })).toBeNull();
    expect(harnessModeSelection({ modes: { plan: 'yes' } })).toBeNull();
  });
});
