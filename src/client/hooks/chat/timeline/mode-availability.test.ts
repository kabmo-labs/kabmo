/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Which mode toggles a harness may offer.
 *
 * The composer used to show Plan and Goal on every chat. For a non-omp ACP agent
 * that is a button whose only outcome is a refusal: there is no `/kabmo-mode`
 * extension to carry either mode, and its own mode selector is the only place
 * `plan` can live (measured: claude publishes `plan`, opencode's modes are its
 * own three agents).
 */

import { describe, expect, test } from 'bun:test';
import { modeAvailability } from '@/client/hooks/chat/timeline/modes';

describe('modeAvailability', () => {
  test('omp RPC carries both modes', () => {
    expect(modeAvailability({ harness: 'omp-rpc', modeValues: [] })).toEqual({ plan: true, goal: true });
  });

  test('omp over ACP carries both modes', () => {
    expect(modeAvailability({ harness: 'omp-acp', modeValues: [] })).toEqual({ plan: true, goal: true });
  });

  test('an unknown harness keeps the old surface', () => {
    expect(modeAvailability({})).toEqual({ plan: true, goal: true });
  });

  test('an ACP agent with a plan mode offers Plan and Goal', () => {
    expect(modeAvailability({ harness: 'claude', modeValues: ['default', 'acceptEdits', 'plan'] })).toEqual({
      plan: true,
      goal: true,
    });
  });

  test('an ACP agent without a plan mode still offers Goal', () => {
    // The goal record and its loop are Kabmo-owned; the agent needs no mode
    // value for them.
    expect(modeAvailability({ harness: 'opencode', modeValues: ['Sisyphus', 'Prometheus'] })).toEqual({
      plan: false,
      goal: true,
    });
  });

  test('a probe that has not arrived yet hides Plan for a non-omp harness', () => {
    expect(modeAvailability({ harness: 'opencode', modeValues: undefined })).toEqual({ plan: false, goal: true });
  });
});
