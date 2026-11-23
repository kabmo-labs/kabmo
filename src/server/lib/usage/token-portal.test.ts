/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * TokenPortal's key body is short and the traps are arithmetic: the endpoint
 * reports whole Rupiah (not cents), `limit` is legitimately null while
 * `limit_remaining` still carries the wallet, and a cap that was never set must
 * not become a 0%-used bar. Every fixture below is the live 2026-11-23 shape.
 */

import { describe, expect, test } from 'bun:test';

import {
  isTokenPortalBaseUrl,
  parseTokenPortalBalance,
  tokenPortalKeyUrl,
  tokenPortalWindows,
} from '@/server/lib/usage/token-portal';

/** The live body, verbatim, with the stored `tp-` key. */
const LIVE = {
  data: {
    label: 'Kabmo',
    currency: 'IDR',
    balance: 8827,
    limit: null,
    limit_remaining: 8827,
    is_free_tier: false,
    session_budget: null,
    subscription: null,
  },
};

describe('isTokenPortalBaseUrl', () => {
  test('matches the vendor host at any path or subdomain', () => {
    expect(isTokenPortalBaseUrl('https://tokenportal.id/v1')).toBe(true);
    expect(isTokenPortalBaseUrl('https://tokenportal.id/v1/')).toBe(true);
    expect(isTokenPortalBaseUrl('https://api.tokenportal.id')).toBe(true);
    expect(isTokenPortalBaseUrl('https://TOKENPORTAL.ID/v1')).toBe(true);
  });

  test('a look-alike host, another gateway and a malformed URL are not TokenPortal', () => {
    expect(isTokenPortalBaseUrl('https://tokenportal.id.evil.example/v1')).toBe(false);
    expect(isTokenPortalBaseUrl('https://kiosapi.com/v1')).toBe(false);
    expect(isTokenPortalBaseUrl('https://aihub.brisnets.com/v1')).toBe(false);
    expect(isTokenPortalBaseUrl('tokenportal.id')).toBe(false);
    expect(isTokenPortalBaseUrl('')).toBe(false);
  });
});

describe('tokenPortalKeyUrl', () => {
  test('the key endpoint hangs off the origin, not the /v1 base', () => {
    expect(tokenPortalKeyUrl('https://tokenportal.id/v1')).toBe('https://tokenportal.id/v1/key');
    expect(tokenPortalKeyUrl('https://api.tokenportal.id/v1/')).toBe('https://api.tokenportal.id/v1/key');
  });

  test('a missing or malformed base URL keeps the canonical origin', () => {
    expect(tokenPortalKeyUrl()).toBe('https://tokenportal.id/v1/key');
    expect(tokenPortalKeyUrl('not a url')).toBe('https://tokenportal.id/v1/key');
  });
});

describe('parseTokenPortalBalance', () => {
  test('the live body maps field for field, keeping Rupiah whole', () => {
    expect(parseTokenPortalBalance(LIVE)).toEqual({
      label: 'Kabmo',
      currency: 'IDR',
      balance: 8827,
      limit: null,
      limitRemaining: 8827,
      isFreeTier: false,
      sessionBudget: null,
    });
  });

  test('numeric strings and an unwrapped body are accepted (vendor envelope drift)', () => {
    const balance = parseTokenPortalBalance({ currency: 'idr', balance: '15000', limit: '20000', limit_remaining: '12000' });
    expect(balance.currency).toBe('IDR');
    expect(balance.balance).toBe(15000);
    expect(balance.limit).toBe(20000);
    expect(balance.limitRemaining).toBe(12000);
    expect(balance.label).toBeNull();
  });

  test('a body without a balance or currency is a schema change, not an empty wallet', () => {
    expect(() => parseTokenPortalBalance({ data: { currency: 'IDR' } })).toThrow('unexpected key response');
    expect(() => parseTokenPortalBalance({ data: { balance: 10 } })).toThrow('unexpected key response');
    expect(() => parseTokenPortalBalance(null)).toThrow('unexpected key response');
  });
});

describe('tokenPortalWindows', () => {
  test('an uncapped key keeps its remaining Rupiah and reports no fraction', () => {
    const windows = tokenPortalWindows(parseTokenPortalBalance(LIVE));
    expect(windows).toHaveLength(1);
    const [balance] = windows;
    expect(balance.id).toBe('tokenportal:balance');
    expect(balance.unit).toBe('idr');
    expect(balance.remaining).toBe(8827);
    expect(balance.limit).toBeUndefined();
    expect(balance.usedFraction).toBeUndefined();
    expect(balance.status).toBe('ok');
  });

  test('a capped key derives spend and fraction from limit_remaining', () => {
    const [balance] = tokenPortalWindows(parseTokenPortalBalance({
      data: { currency: 'IDR', balance: '15000', limit: '20000', limit_remaining: '12000' },
    }));
    expect(balance.limit).toBe(20000);
    expect(balance.used).toBe(8000);
    expect(balance.remaining).toBe(12000);
    expect(balance.usedFraction).toBeCloseTo(0.4, 5);
  });

  test('an emptied wallet is exhausted', () => {
    const [balance] = tokenPortalWindows(parseTokenPortalBalance({
      data: { currency: 'IDR', balance: 0, limit_remaining: 0 },
    }));
    expect(balance.status).toBe('exhausted');
  });

  test('a session budget is its own window and its own amount', () => {
    const windows = tokenPortalWindows(parseTokenPortalBalance({
      data: { currency: 'IDR', balance: 5000, limit_remaining: 5000, session_budget: 2500 },
    }));
    expect(windows.map((window) => window.id)).toEqual(['tokenportal:balance', 'tokenportal:session']);
    expect(windows[1].unit).toBe('idr');
    expect(windows[1].remaining).toBe(2500);
  });

  test('a currency the panel cannot render keeps the amount but not a wrong symbol', () => {
    const [balance] = tokenPortalWindows(parseTokenPortalBalance({
      data: { currency: 'EUR', balance: 5 },
    }));
    expect(balance.unit).toBe('unknown');
    expect(balance.remaining).toBe(5);
  });
});
