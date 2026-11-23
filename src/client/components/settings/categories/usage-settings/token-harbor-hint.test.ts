/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The Token Harbor sidebar hint. It is the one line the provider list shows, so
 * it has to carry the Pass percentage (the number that decides whether covered
 * calls keep working), and it must not print "0%" for a window that never
 * started — a fresh account would read as "nothing left" instead of "not yet
 * begun". Kept beside `token-harbor-card.test.tsx`, which pins the card itself.
 */

import { describe, expect, test } from 'bun:test';

import { buildProviders } from '@/client/components/settings/categories/usage-settings/providers';
import type { TokenHarborAllowance, TokenHarborUsageReport, UsageProviderSummary } from '@/shared/types';

const summary = (overrides: Partial<UsageProviderSummary> = {}): UsageProviderSummary =>
  ({ id: 'token-harbour', name: 'Token Harbor', credentialSources: [], tracked: true, limits: [], ...overrides }) as UsageProviderSummary;

/** A live-shaped allowance; each test overrides the one fact it is about. */
const tokenHarbor = (overrides: Partial<TokenHarborAllowance> = {}): TokenHarborUsageReport => ({
  allowance: {
    planName: 'Agent Pass',
    onPlan: true,
    planUsedPct: 37,
    planExhausted: false,
    usedPct: 12,
    exhausted: false,
    activated: true,
    resetAt: '2026-11-30T07:45:14.048+00:00',
    periodStartedAt: '2026-11-23T07:45:14.048+00:00',
    periodEndsAt: '2026-11-30T07:45:14.048+00:00',
    freeModels: [],
    modelsEnabled: true,
    ...overrides,
  },
});

function hint(report: TokenHarborUsageReport): string | undefined {
  return buildProviders({
    isMock: false,
    generatedAt: '',
    providers: [summary({ tokenHarbor: report })],
  })[0]?.hint;
}

describe('Token Harbor provider hint', () => {
  test('a Pass row carries the plan, its percentage and the window', () => {
    expect(hint(tokenHarbor())).toBe('Agent Pass · 37% · 7d');
  });

  test('a free-only row reports the free percentage instead of a Pass one', () => {
    expect(hint(tokenHarbor({ onPlan: false, planName: null, planUsedPct: 0 }))).toBe('12% free · 7d');
  });

  test('a window that never started says so rather than reading "0%"', () => {
    expect(hint(tokenHarbor({
      activated: false,
      planUsedPct: 0,
      usedPct: 0,
      resetAt: null,
      periodStartedAt: null,
      periodEndsAt: null,
    }))).toBe('Agent Pass · not started');
  });
});