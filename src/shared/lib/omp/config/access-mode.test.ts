/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The access tier is remembered PER HARNESS, and the two transports mean
 * different things by the same three words: omp's transports carry omp's own
 * approval gate, while an ACP agent decides which calls it asks about and
 * Kabmo's tier only answers those requests. So a `yolo` chosen for omp must
 * never become another agent's auto-approval just because the operator switched
 * the composer's tab.
 */

import { describe, expect, test } from 'bun:test';
import {
  HARNESS_ACCESS_MODES_SETTING_KEY,
  accessModeForHarness,
  isOmpHarness,
  readAccessModePicks,
} from '@/shared/lib/omp/config/access-mode';

describe('isOmpHarness', () => {
  test('both omp transports, and an unresolved harness, are omp', () => {
    expect(isOmpHarness('omp-rpc')).toBe(true);
    expect(isOmpHarness('omp-acp')).toBe(true);
    expect(isOmpHarness(undefined)).toBe(true);
    expect(isOmpHarness(null)).toBe(true);
  });

  test('every other agent is not', () => {
    expect(isOmpHarness('claude')).toBe(false);
    expect(isOmpHarness('codex')).toBe(false);
  });
});

describe('readAccessModePicks', () => {
  test('keeps only the values that are approval modes', () => {
    expect(
      readAccessModePicks({ [HARNESS_ACCESS_MODES_SETTING_KEY]: { claude: 'yolo', codex: 'sudo', omp: 7 } }),
    ).toEqual({ claude: 'yolo' });
  });

  test('a missing or malformed map reads as no picks', () => {
    expect(readAccessModePicks({})).toEqual({});
    expect(readAccessModePicks({ [HARNESS_ACCESS_MODES_SETTING_KEY]: 'yolo' })).toEqual({});
    expect(readAccessModePicks(undefined)).toEqual({});
  });
});

describe('accessModeForHarness', () => {
  test('omp falls back to the global spawn-time pick', () => {
    expect(accessModeForHarness('omp-rpc', {}, { omp_access_mode: 'write' })).toBe('write');
    // An unresolved harness is the default agent, so it reads the same value.
    expect(accessModeForHarness(undefined, {}, { omp_access_mode: 'write' })).toBe('write');
  });

  test("omp's own pick outranks the global one", () => {
    expect(accessModeForHarness('omp-rpc', { 'omp-rpc': 'always-ask' }, { omp_access_mode: 'yolo' })).toBe(
      'always-ask',
    );
  });

  test('another harness does NOT inherit omp’s global pick', () => {
    // The defect this guards: `yolo` chosen on omp silently auto-approved every
    // approval the next agent raised, a grant the operator never gave it.
    expect(accessModeForHarness('claude', {}, { omp_access_mode: 'yolo' })).toBe('always-ask');
  });

  test('a harness with its own pick shows that pick', () => {
    expect(accessModeForHarness('claude', { claude: 'write' }, { omp_access_mode: 'yolo' })).toBe('write');
  });
});
