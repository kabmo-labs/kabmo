/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, test } from 'bun:test';
import type { UsageLimitWindow } from '@/shared/types';

import {
  localAntigravityLimits,
  localAntigravityRow,
  resolveUsageTracking,
} from '@/server/lib/usage/providers.server';

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

/**
 * The local Antigravity sign-in, folded into the provider rows.
 *
 * Measured on this machine (2026-11-24): the Antigravity CLI keeps its OAuth
 * token in the OS keyring, which omp's provider list never sees, so the Usage
 * panel had an empty card for a product that was signed in and in use. omp's
 * own adapter covers the same buckets when it holds the credential, so these
 * two rules decide whether a reader sees the quota once, twice, or not at all.
 */
describe('localAntigravityLimits', () => {
  const window: UsageLimitWindow = {
    id: 'google-antigravity:google:default:weekly',
    label: 'Weekly limit',
    unit: 'percent',
    status: 'ok',
    usedFraction: 0.1,
  };

  test("omp's own windows win, so one quota is never drawn twice", () => {
    const ompWindow: UsageLimitWindow = { ...window, id: 'google-antigravity:google:default:5h' };
    expect(localAntigravityLimits([ompWindow], { windows: [window] })).toEqual({ windows: [] });
  });

  test('with nothing from omp, the local reading is the row', () => {
    expect(localAntigravityLimits([], { windows: [window] })).toEqual({ windows: [window] });
  });

  test('a failed local read hands the row its reason, never an empty card', () => {
    expect(localAntigravityLimits([], { windows: [], error: 'sign-in expired' }))
      .toEqual({ windows: [], error: 'sign-in expired' });
  });

  test('a machine with no Antigravity sign-in contributes nothing', () => {
    expect(localAntigravityLimits([], null)).toEqual({ windows: [] });
  });
});

describe('localAntigravityRow', () => {
  test('carries the local credential provenance and counts as tracked', () => {
    const row = localAntigravityRow(
      { windows: [{ id: 'google-antigravity:google:default:weekly', label: 'Weekly limit', unit: 'percent', status: 'ok' }] },
      'Google Antigravity',
      '/api/provider-icon?slug=google-antigravity&v=3',
    );
    expect(row.id).toBe('google-antigravity');
    expect(row.name).toBe('Google Antigravity');
    expect(row.credentialSources).toEqual(['antigravity']);
    expect(row.tracked).toBe(true);
    expect(row.iconUrl).toBe('/api/provider-icon?slug=google-antigravity&v=3');
    expect(row.limits).toHaveLength(1);
    expect(row.error).toBeUndefined();
  });

  test('an absent icon stays absent, and a failure rides along', () => {
    const row = localAntigravityRow({ windows: [], error: 'sign-in expired' }, 'Google Antigravity');
    expect('iconUrl' in row).toBe(false);
    expect(row.error).toBe('sign-in expired');
    expect(row.limits).toEqual([]);
  });
});
