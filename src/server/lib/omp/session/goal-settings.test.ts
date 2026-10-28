/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The goal loop's settings and the one value they share with the composer.
 *
 * `normalizeGoalBudget` is the load-bearing part: three surfaces accept a budget
 * (the dialog field, the default in Settings, the wire payload), and "no budget"
 * has to be `null` everywhere — omp refuses a non-positive budget, and a `0`
 * that slipped through as "unlimited" would be read as "already spent" by the
 * loop's own guard.
 */

import { describe, expect, test } from 'bun:test';
import { normalizeGoalBudget } from '@/shared/lib/omp/mode/budget';
import { readGoalSettings } from '@/server/lib/omp/session/goal-settings.server';

describe('normalizeGoalBudget', () => {
  test('a positive integer is a budget, whatever shape it arrived in', () => {
    expect(normalizeGoalBudget(200000)).toBe(200000);
    expect(normalizeGoalBudget(' 1500 ')).toBe(1500);
  });

  test('everything else means "no budget", never zero', () => {
    expect(normalizeGoalBudget('')).toBeNull();
    expect(normalizeGoalBudget('off')).toBeNull();
    expect(normalizeGoalBudget(0)).toBeNull();
    expect(normalizeGoalBudget(-5)).toBeNull();
    expect(normalizeGoalBudget('1.5')).toBeNull();
    expect(normalizeGoalBudget(null)).toBeNull();
    expect(normalizeGoalBudget(undefined)).toBeNull();
  });
});

describe('readGoalSettings', () => {
  test('the auditor is on by default, on the session model', async () => {
    // No database in this process: the read must still answer its defaults
    // rather than throw into a turn's settle path.
    const settings = await readGoalSettings();
    expect(settings.auditEnabled).toBe(true);
    expect(settings.auditModel).toBe('');
  });
});
