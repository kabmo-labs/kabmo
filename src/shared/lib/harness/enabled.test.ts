/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The roster: which harnesses an install keeps ON.
 *
 * The decision that matters is what is STORED — the DISABLED list, not the
 * enabled one — because an adapter added by a later Kabmo update must arrive on.
 * Storing "what the user had enabled" would freeze the roster on the day they
 * first opened Settings, and a new agent would silently never appear.
 *
 * The other half is the built-in transport: `omp` over RPC is the path this app
 * IS, so it has no switch in either direction.
 */

import { describe, expect, test } from 'bun:test';
import {
  harnessEnabled,
  harnessSwitchable,
  parseDisabledHarnesses,
  withHarnessEnabled,
} from '@/shared/lib/harness/enabled';

describe('which harnesses can be switched', () => {
  test('the built-in transport cannot', () => {
    expect(harnessSwitchable('omp-rpc')).toBe(false);
    expect(harnessEnabled('omp-rpc', [])).toBe(true);
    // Even a hand-edited row naming it is ignored, in both directions.
    expect(harnessEnabled('omp-rpc', ['omp-rpc'])).toBe(true);
    expect(withHarnessEnabled('omp-rpc', false, [])).toEqual([]);
    expect(withHarnessEnabled('omp-rpc', true, ['omp-rpc'])).toEqual(['omp-rpc']);
  });

  test('an adapter can', () => {
    expect(harnessSwitchable('claude')).toBe(true);
    expect(harnessEnabled('claude', [])).toBe(true);
    expect(harnessEnabled('claude', ['claude'])).toBe(false);
  });
});

describe('the stored list', () => {
  test('an absent or malformed row means everything is on', () => {
    // Not "everything is off": the absence of a roster is the DEFAULT roster.
    for (const raw of [null, undefined, 42, 'claude', { claude: true }, []]) {
      expect(parseDisabledHarnesses(raw)).toEqual([]);
    }
  });

  test('only ids this build knows survive', () => {
    // A retired adapter's id must not sit in the list forever, counted as
    // "disabled" for a row nothing draws.
    expect(parseDisabledHarnesses(['claude', 'retired-agent', 'omp-rpc', 7, null, 'claude']))
      .toEqual(['claude']);
  });

  test('switching off appends, switching on removes, order preserved', () => {
    expect(withHarnessEnabled('claude', false, [])).toEqual(['claude']);
    expect(withHarnessEnabled('codex', false, ['claude'])).toEqual(['claude', 'codex']);
    expect(withHarnessEnabled('claude', true, ['claude', 'codex'])).toEqual(['codex']);
    // A no-op switch on an already-on harness leaves the list untouched.
    expect(withHarnessEnabled('pi', true, ['claude'])).toEqual(['claude']);
    // And switching an already-off harness off does not duplicate it.
    expect(withHarnessEnabled('claude', false, ['claude'])).toEqual(['claude']);
  });

  test('the round trip reports exactly what was stored', () => {
    let disabled: string[] = [];
    disabled = withHarnessEnabled('claude', false, disabled);
    disabled = withHarnessEnabled('cursor', false, disabled);
    expect(harnessEnabled('claude', disabled)).toBe(false);
    expect(harnessEnabled('cursor', disabled)).toBe(false);
    expect(harnessEnabled('codex', disabled)).toBe(true);
    disabled = withHarnessEnabled('claude', true, disabled);
    expect(harnessEnabled('claude', disabled)).toBe(true);
    expect(harnessEnabled('cursor', disabled)).toBe(false);
  });
});
