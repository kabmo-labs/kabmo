/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, test } from 'bun:test';

import { parseOmpUsageSnapshot } from '@/server/lib/usage/omp-usage.server';

/**
 * `omp usage --json` is the only source of provider-REPORTED quota, and the
 * shapes below are what omp 18.3.0 emits. The parser is the boundary that
 * turns that external payload into Kabmo's flat `UsageLimitWindow[]`,
 * so its precedence rules and its tolerance of junk are the contract.
 */
describe('parseOmpUsageSnapshot', () => {
  test('resolves usedFraction with omp precedence: explicit > used/limit > percent > inverted remaining', () => {
    const snapshot = parseOmpUsageSnapshot({
      reports: [
        {
          provider: 'anthropic',
          limits: [
            { id: 'a', label: 'explicit', amount: { used: 9, limit: 10, usedFraction: 0.25, unit: 'percent' }, scope: { provider: 'anthropic' } },
            { id: 'b', label: 'ratio', amount: { used: 30, limit: 60, unit: 'requests' }, scope: { provider: 'anthropic' } },
            { id: 'c', label: 'percent', amount: { used: 42, unit: 'percent' }, scope: { provider: 'anthropic' } },
            { id: 'd', label: 'remaining', amount: { remainingFraction: 0.2, unit: 'percent' }, scope: { provider: 'anthropic' } },
          ],
        },
      ],
    });

    const limits = snapshot.reports.get('anthropic')?.limits ?? [];
    expect(limits.map((limit) => limit.usedFraction)).toEqual([0.25, 0.5, 0.42, 0.8]);
  });

  test('merges multiple accounts of one provider and keeps each window id', () => {
    const snapshot = parseOmpUsageSnapshot({
      reports: [
        {
          provider: 'anthropic',
          limits: [{ id: 'acct-1:5h', label: '5 hour', scope: { provider: 'anthropic', accountId: 'a1' }, amount: { usedFraction: 0.1, unit: 'percent' } }],
        },
        {
          provider: 'anthropic',
          limits: [{ id: 'acct-2:5h', label: '5 hour', scope: { provider: 'anthropic', accountId: 'a2' }, amount: { usedFraction: 0.9, unit: 'percent' } }],
        },
      ],
    });

    const report = snapshot.reports.get('anthropic');
    expect(report?.limits.length).toBe(2);
    expect(report?.limits.map((limit) => limit.accountId)).toEqual(['a1', 'a2']);
  });

  test('carries window label, reset clock and notes through', () => {
    const snapshot = parseOmpUsageSnapshot({
      reports: [
        {
          provider: 'zai',
          notes: ['OMP-observed spend only'],
          limits: [
            {
              id: 'zai:5h',
              label: 'Coding plan 5 hour',
              window: { id: '5h', label: '5 Hour', resetsAt: 1_760_000_000_000 },
              scope: { provider: 'zai', modelId: 'glm-5.3' },
              amount: { used: 7, limit: 10, unit: 'requests' },
              status: 'warning',
              notes: ['Overage requests: 3'],
            },
          ],
        },
      ],
    });

    const report = snapshot.reports.get('zai');
    const limit = report?.limits[0];
    expect(limit?.windowLabel).toBe('5h');
    expect(limit?.resetsAt).toBe(1_760_000_000_000);
    expect(limit?.modelId).toBe('glm-5.3');
    expect(limit?.status).toBe('warning');
    expect(limit?.notes).toEqual(['Overage requests: 3']);
    expect(report?.notes).toEqual(['OMP-observed spend only']);
  });

  test('collects providers whose credentials produced no report', () => {
    const snapshot = parseOmpUsageSnapshot({
      reports: [],
      accountsWithoutUsage: [
        { provider: 'commandcode', type: 'oauth' },
        { provider: 'commandcode', type: 'oauth' },
        { provider: 'deepseek', type: 'api_key' },
      ],
    });

    expect(snapshot.reports.size).toBe(0);
    expect(snapshot.accountsWithoutUsage).toEqual(['commandcode', 'deepseek']);
  });

  test('degrades junk to an empty snapshot instead of throwing', () => {
    for (const payload of [null, 'nope', 42, { reports: 'no' }, { reports: [null, 7] }]) {
      const snapshot = parseOmpUsageSnapshot(payload);
      expect(snapshot.reports.size).toBe(0);
      expect(snapshot.accountsWithoutUsage).toEqual([]);
    }
  });

  test('drops a limit without an id and defaults an unknown unit/status', () => {
    const snapshot = parseOmpUsageSnapshot({
      reports: [
        {
          provider: 'cursor',
          limits: [
            { label: 'no id', amount: { usedFraction: 0.5, unit: 'percent' } },
            { id: 'cursor:fast', label: 'Fast requests', amount: { used: 1, unit: 'widgets' }, status: 'weird' },
          ],
        },
      ],
    });

    const limits = snapshot.reports.get('cursor')?.limits ?? [];
    expect(limits.length).toBe(1);
    expect(limits[0].unit).toBe('unknown');
    expect(limits[0].status).toBe('unknown');
  });
});
