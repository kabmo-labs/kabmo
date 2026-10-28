/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, test } from 'bun:test';

import { BALANCE_ADAPTER_SLUGS, parseVendorBalance } from '@/server/lib/usage/vendor-balance.server';

/**
 * The field mapping is the part that silently breaks when a vendor changes its
 * schema — a renamed field yields `undefined`, which would render as an empty
 * card rather than an error. Each payload below is the documented response
 * shape for that vendor.
 */
describe('parseVendorBalance', () => {
  test('has no adapter for a provider without a balance endpoint', () => {
    expect(BALANCE_ADAPTER_SLUGS).not.toContain('anthropic');
    expect(parseVendorBalance('anthropic', {})).toBeNull();
    expect(parseVendorBalance('groq', {})).toBeNull();
  });

  test('OpenRouter reads the current key limit/usage envelope', () => {
    const windows = parseVendorBalance('openrouter', {
      data: {
        limit: 100,
        limit_remaining: 74.5,
        usage: 25.5,
        usage_daily: 1.82,
        limit_reset: 'monthly',
      },
    });
    const credits = windows?.find((window) => window.id === 'openrouter:credits');
    expect(credits?.unit).toBe('usd');
    expect(credits?.limit).toBe(100);
    expect(credits?.remaining).toBe(74.5);
    expect(credits?.usedFraction).toBeCloseTo(0.255, 5);
    expect(credits?.status).toBe('ok');
    expect(windows?.some((window) => window.id === 'openrouter:daily')).toBe(true);
  });

  test('OpenRouter without a credit limit still reports usage', () => {
    const windows = parseVendorBalance('openrouter', { data: { usage: 3.5 } });
    const credits = windows?.[0];
    expect(credits?.limit).toBeUndefined();
    expect(credits?.usedFraction).toBeUndefined();
    expect(credits?.notes?.[0]).toContain('No credit limit');
  });

  test('Moonshot splits available/voucher/cash and flags an empty balance', () => {
    const windows = parseVendorBalance('moonshot', {
      code: 0,
      status: true,
      data: { available_balance: 49.58894, voucher_balance: 46.58893, cash_balance: 3.00001 },
    });
    expect(windows?.map((window) => window.id)).toEqual([
      'moonshot:available',
      'moonshot:voucher',
      'moonshot:cash',
    ]);
    expect(windows?.[0].remaining).toBeCloseTo(49.58894, 5);

    const drained = parseVendorBalance('moonshot', { data: { available_balance: 0 } });
    expect(drained?.[0].status).toBe('exhausted');
  });

  test('SiliconFlow reads data.balance fields', () => {
    const windows = parseVendorBalance('siliconflow', {
      code: 20000,
      data: { totalBalance: '88.88', chargeBalance: '88.00', balance: '0.88' },
    });
    expect(windows?.find((window) => window.id === 'siliconflow:total')?.remaining).toBeCloseTo(88.88, 5);
    expect(windows?.find((window) => window.id === 'siliconflow:charge')?.remaining).toBeCloseTo(88, 5);
  });

  test('Novita converts 1/10000 USD units', () => {
    const windows = parseVendorBalance('novita', {
      availableBalance: '1000000',
      cashBalance: '800000',
      creditLimit: '200000',
    });
    const available = windows?.find((window) => window.id === 'novita:available');
    expect(available?.remaining).toBeCloseTo(100, 5);
    expect(available?.limit).toBeCloseTo(20, 5);
    expect(windows?.find((window) => window.id === 'novita:cash')?.remaining).toBeCloseTo(80, 5);
  });

  test('DeepInfra maps one window per API key with its monthly limit', () => {
    const windows = parseVendorBalance('deepinfra', [
      { token_id: 'tok_1', name: 'prod', limit: 50, spend: 12.5 },
      { token_id: 'tok_2', name: 'dev', limit: null, spend: null },
    ]);
    expect(windows?.length).toBe(2);
    expect(windows?.[0].label).toBe('prod · monthly');
    expect(windows?.[0].remaining).toBeCloseTo(37.5, 5);
    expect(windows?.[1].limit).toBeUndefined();
    expect(windows?.[1].notes?.[0]).toContain('No monthly limit');
  });

  test('rejects an unusable payload instead of inventing windows', () => {
    expect(() => parseVendorBalance('moonshot', 'not json')).toThrow();
    expect(() => parseVendorBalance('deepinfra', { not: 'an array' })).toThrow();
  });
});
