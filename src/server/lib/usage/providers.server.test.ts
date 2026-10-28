/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, test } from 'bun:test';

import { resolveUsageTracking } from '@/server/lib/usage/providers.server';

/**
 * `tracked` decides which explanation the Usage card shows when a provider has
 * no quota windows: "omp has no usage endpoint for this" versus "omp tracks it
 * but the endpoint returned nothing". Getting this backwards tells the user a
 * supported provider is unsupported (or vice versa), so the rule is pinned
 * here against the shapes `omp usage --json` actually produces.
 *
 * Verified against omp 18.3.0: with a stored DeepSeek key and no adapter,
 * `accountsWithoutUsage` does NOT list deepseek; with a stored Anthropic key
 * whose fetch fails, it DOES list anthropic.
 */
describe('resolveUsageTracking', () => {
  test('a provider with a report and windows is tracked', () => {
    const result = resolveUsageTracking('anthropic', {
      reports: new Map([['anthropic', { provider: 'anthropic', limits: [] }]]),
      accountsWithoutUsage: [],
    });
    expect(result).toEqual({ tracked: true, limitsUnavailable: false });
  });

  test('a provider listed in accountsWithoutUsage is tracked but empty', () => {
    const result = resolveUsageTracking('anthropic', {
      reports: new Map(),
      accountsWithoutUsage: ['anthropic'],
    });
    expect(result).toEqual({ tracked: true, limitsUnavailable: true });
  });

  test('a provider in neither list has no usage endpoint', () => {
    // deepseek / kenari / arbitrary gateways: credentialed, but omp ships no
    // adapter, so it appears in neither structure.
    const result = resolveUsageTracking('deepseek', {
      reports: new Map([['anthropic', { provider: 'anthropic', limits: [] }]]),
      accountsWithoutUsage: ['anthropic'],
    });
    expect(result).toEqual({ tracked: false, limitsUnavailable: false });
  });
});
