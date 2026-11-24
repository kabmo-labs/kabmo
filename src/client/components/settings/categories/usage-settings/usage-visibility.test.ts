/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * `hasUsageToShow` decides which cards the Usage panel's hide filter drops.
 *
 * The cases a wrong implementation gets silently:
 *
 * - A rich report counts by its PAYLOAD. The server returns `{ error }` when an
 *   upstream call fails, so a `summary.kenari` that is present but carries only
 *   an error is a failure, not usage — treating presence as usage would keep
 *   exactly the cards the filter exists to remove.
 * - A failed read is KEPT whatever its windows say. Hiding it would be a silent
 *   fallback: the panel would lose the one row that explains why a configured
 *   provider reports nothing.
 */

import { describe, expect, test } from 'bun:test';
import { hasUsageToShow } from '@/client/components/settings/categories/usage-settings/providers';
import type { UsageLimitWindow, UsageProviderSummary } from '@/shared/types';

const window = (overrides: Partial<UsageLimitWindow> = {}): UsageLimitWindow =>
  ({ id: 'w', label: 'Window', unit: 'percent', status: 'ok', ...overrides }) as UsageLimitWindow;

const summary = (overrides: Partial<UsageProviderSummary> = {}): UsageProviderSummary =>
  ({ id: 'p', name: 'P', credentialSources: [], tracked: true, limits: [], ...overrides }) as UsageProviderSummary;

describe('hasUsageToShow', () => {
  test('a native window is usage', () => {
    expect(hasUsageToShow(summary({ limits: [window({ usedFraction: 0.1 })] }))).toBe(true);
  });

  test('a provider with no quota source and no balance endpoint is not', () => {
    // The card's whole body is "No quota source for this provider" — the row the
    // panel's hide filter exists to drop.
    expect(hasUsageToShow(summary({ tracked: false, limits: [] }))).toBe(false);
    expect(hasUsageToShow(summary({ tracked: true, limits: [], limitsUnavailable: true }))).toBe(false);
  });

  test('a rich report counts by its payload, not by its presence', () => {
    expect(hasUsageToShow(summary({ deepseek: { balance: { isAvailable: true, entries: [] } } }))).toBe(true);
    expect(hasUsageToShow(summary({ kenari: { quota: { planName: null, windows: [], coupon: null } } }))).toBe(true);
    expect(hasUsageToShow(summary({
      tokenPortal: {
        balance: {
          label: null, currency: 'IDR', balance: 0, limit: null,
          limitRemaining: null, isFreeTier: false, sessionBudget: null,
        },
      },
    }))).toBe(true);
    expect(hasUsageToShow(summary({ deepseek: { error: 'unreachable' } }))).toBe(false);
    expect(hasUsageToShow(summary({ kenari: { error: 'kenari quota failed' }, tokenHarbor: { error: 'unreachable' } }))).toBe(false);
  });

  test('a failed read is kept, whatever the windows say', () => {
    expect(hasUsageToShow(summary({ error: 'invalid or expired credential', limits: [] }))).toBe(true);
  });
});
