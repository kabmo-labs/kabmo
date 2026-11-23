/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Token Harbor reports its allowance as two integer percentages sharing one
 * window, with `plan_exhausted`/`exhausted` deciding "spent" because the
 * percentages are rounded. Every fixture below is the documented shape; the
 * live endpoint was verified to add undocumented fields and to spell `models`
 * without the `:free` suffix the docs show, so the parser must ignore the
 * extras and pass ids through unchanged.
 */

import { describe, expect, test } from 'bun:test';

import {
  allowanceWindows,
  isTokenHarborBaseUrl,
  parseTokenHarborAllowance,
  tokenHarborAllowanceUrl,
} from '@/server/lib/usage/token-harbor';

/** The Office Pass example from the allowance docs. */
const OFFICE_PASS = {
  plan_name: 'Office Pass',
  on_plan: true,
  plan_used_pct: 37,
  plan_exhausted: false,
  used_pct: 12,
  exhausted: false,
  activated: true,
  period_started_at: '2026-11-05T09:12:44.512+00:00',
  period_ends_at: '2026-11-12T09:12:44.512+00:00',
  reset_at: '2026-11-12T09:12:44.512+00:00',
  models: ['deepseek-v4.1-flash', 'mimo-v2.6-flash'],
  models_enabled: true,
};

describe('isTokenHarborBaseUrl', () => {
  test('matches the vendor host at any path or subdomain', () => {
    expect(isTokenHarborBaseUrl('https://tokenharbor.ai/v1')).toBe(true);
    expect(isTokenHarborBaseUrl('https://tokenharbor.ai/v1/')).toBe(true);
    expect(isTokenHarborBaseUrl('https://www.tokenharbor.ai')).toBe(true);
    expect(isTokenHarborBaseUrl('https://TOKENHARBOR.AI/v1')).toBe(true);
  });

  test('a look-alike host, another vendor and a malformed URL are not Token Harbor', () => {
    expect(isTokenHarborBaseUrl('https://tokenharbor.ai.evil.example/v1')).toBe(false);
    expect(isTokenHarborBaseUrl('https://api.deepseek.com/v1')).toBe(false);
    expect(isTokenHarborBaseUrl('tokenharbor.ai')).toBe(false);
    expect(isTokenHarborBaseUrl('')).toBe(false);
  });
});

describe('tokenHarborAllowanceUrl', () => {
  test('the allowance endpoint hangs off the origin, not the /v1 base', () => {
    expect(tokenHarborAllowanceUrl('https://tokenharbor.ai/v1'))
      .toBe('https://tokenharbor.ai/api/cli/free-tier');
    expect(tokenHarborAllowanceUrl('https://tokenharbor.ai/v1/'))
      .toBe('https://tokenharbor.ai/api/cli/free-tier');
  });

  test('a missing or malformed base URL keeps the canonical origin', () => {
    expect(tokenHarborAllowanceUrl()).toBe('https://tokenharbor.ai/api/cli/free-tier');
    expect(tokenHarborAllowanceUrl('not a url')).toBe('https://tokenharbor.ai/api/cli/free-tier');
  });
});

describe('parseTokenHarborAllowance', () => {
  test('the documented Office Pass body maps field for field', () => {
    expect(parseTokenHarborAllowance(OFFICE_PASS)).toEqual({
      planName: 'Office Pass',
      onPlan: true,
      planUsedPct: 37,
      planExhausted: false,
      usedPct: 12,
      exhausted: false,
      activated: true,
      resetAt: '2026-11-12T09:12:44.512+00:00',
      periodStartedAt: '2026-11-05T09:12:44.512+00:00',
      periodEndsAt: '2026-11-12T09:12:44.512+00:00',
      freeModels: ['deepseek-v4.1-flash', 'mimo-v2.6-flash'],
      modelsEnabled: true,
    });
  });

  test('an account without a Pass reports no plan and a zero Pass percentage', () => {
    const allowance = parseTokenHarborAllowance({
      ...OFFICE_PASS,
      plan_name: null,
      on_plan: false,
      plan_used_pct: 0,
      plan_exhausted: false,
    });
    expect(allowance.planName).toBeNull();
    expect(allowance.onPlan).toBe(false);
    expect(allowance.planUsedPct).toBe(0);
  });

  test('a window that never started carries no timestamps', () => {
    const allowance = parseTokenHarborAllowance({
      ...OFFICE_PASS,
      activated: false,
      plan_used_pct: 0,
      used_pct: 0,
      period_started_at: null,
      period_ends_at: null,
      reset_at: null,
    });
    expect(allowance.activated).toBe(false);
    expect(allowance.resetAt).toBeNull();
    expect(allowance.periodStartedAt).toBeNull();
    expect(allowance.periodEndsAt).toBeNull();
  });

  test('the spent flag outranks a percentage that is still under 100', () => {
    // Rounded integers: the refused request can arrive at 99, the covered one at 100.
    const allowance = parseTokenHarborAllowance({
      ...OFFICE_PASS,
      plan_used_pct: 99,
      plan_exhausted: true,
    });
    expect(allowance.planUsedPct).toBe(99);
    expect(allowance.planExhausted).toBe(true);
  });

  test('model ids pass through exactly as sent, with no invented suffix', () => {
    const allowance = parseTokenHarborAllowance({
      ...OFFICE_PASS,
      // The live response spells them without `:free`, unlike the docs example.
      models: ['deepseek-v4-flash', ' deepseek-v4.1-flash ', '', 42],
    });
    expect(allowance.freeModels).toEqual(['deepseek-v4-flash', 'deepseek-v4.1-flash']);
  });

  test('models_enabled is off only when the endpoint says so', () => {
    expect(parseTokenHarborAllowance({ ...OFFICE_PASS, models_enabled: false }).modelsEnabled).toBe(false);
    const { models_enabled: _omitted, ...withoutFlag } = OFFICE_PASS;
    expect(parseTokenHarborAllowance(withoutFlag).modelsEnabled).toBe(true);
  });

  test('percentages clamp to 0-100 and tolerate the numeric strings a proxy sends', () => {
    expect(parseTokenHarborAllowance({ ...OFFICE_PASS, plan_used_pct: 137 }).planUsedPct).toBe(100);
    expect(parseTokenHarborAllowance({ ...OFFICE_PASS, used_pct: -4 }).usedPct).toBe(0);
    expect(parseTokenHarborAllowance({ ...OFFICE_PASS, plan_used_pct: '37' }).planUsedPct).toBe(37);
    expect(parseTokenHarborAllowance({ ...OFFICE_PASS, plan_used_pct: null }).planUsedPct).toBeNull();
  });

  test('a body that is not an object is a schema change, not an empty account', () => {
    expect(() => parseTokenHarborAllowance(null)).toThrow();
    expect(() => parseTokenHarborAllowance([])).toThrow();
    expect(() => parseTokenHarborAllowance('ok')).toThrow();
  });
});

describe('allowanceWindows', () => {
  const allowance = parseTokenHarborAllowance(OFFICE_PASS);

  test('a Pass and the free allowance become two percent windows', () => {
    const windows = allowanceWindows(allowance);
    expect(windows.map((row) => row.id)).toEqual(['tokenharbor:pass', 'tokenharbor:free']);
    expect(windows[0]?.label).toBe('Office Pass');
    expect(windows[1]?.label).toBe('Free allowance');
    expect(windows[0]?.used).toBe(37);
    expect(windows[0]?.usedFraction).toBeCloseTo(0.37, 6);
    expect(windows[0]?.unit).toBe('percent');
    expect(windows[0]?.status).toBe('ok');
    expect(windows[0]?.resetsAt).toBe(Date.parse('2026-11-12T09:12:44.512+00:00'));
    expect(windows[1]?.resetsAt).toBe(windows[0]?.resetsAt);
  });

  test('an account without a Pass draws no Pass window', () => {
    const windows = allowanceWindows({ ...allowance, onPlan: false, planName: null });
    expect(windows.map((row) => row.id)).toEqual(['tokenharbor:free']);
  });

  test('the spent flag is the status, and an unstarted window is unknown', () => {
    expect(allowanceWindows({ ...allowance, planExhausted: true })[0]?.status).toBe('exhausted');
    const unstarted = allowanceWindows({ ...allowance, activated: false, resetAt: null });
    expect(unstarted.map((row) => row.status)).toEqual(['unknown', 'unknown']);
    expect(unstarted[0]?.resetsAt).toBeUndefined();
  });

  test('free models that are switched off are stated by the card, not by a window note', () => {
    // The rich card replaces the generic section for this provider, so a note
    // here would never render; `modelsEnabled` is what the card reads.
    const windows = allowanceWindows({ ...allowance, modelsEnabled: false });
    expect(windows.every((row) => row.notes === undefined)).toBe(true);
  });
});