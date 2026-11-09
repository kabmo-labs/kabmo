/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * New API gateways report a dollar amount only through their OpenAI-compatible
 * billing endpoints, in cents, with a sentinel instead of "unlimited". Each
 * payload below is the verbatim shape aihub.brisnets.com returned for the
 * stored `sk-` key (New API v1.0.0-rc.26-aihub.3.12).
 */

import { describe, expect, test } from 'bun:test';

import { isNewApiGatewayBaseUrl, newApiBillingUrl, parseNewApiBilling } from '@/server/lib/usage/new-api';

describe('isNewApiGatewayBaseUrl', () => {
  test('matches the gateway hosts at any path or subdomain', () => {
    expect(isNewApiGatewayBaseUrl('https://aihub.brisnets.com/v1')).toBe(true);
    expect(isNewApiGatewayBaseUrl('https://aihub.brisnets.com/v1/')).toBe(true);
    expect(isNewApiGatewayBaseUrl('https://api.aihub.brisnets.com/v1')).toBe(true);
    expect(isNewApiGatewayBaseUrl('https://easyaihub.ai/v1')).toBe(true);
  });

  test('a vendor host, a look-alike host and a malformed URL are not gateways', () => {
    expect(isNewApiGatewayBaseUrl('https://api.deepseek.com/v1')).toBe(false);
    expect(isNewApiGatewayBaseUrl('https://notbrisnets.com/v1')).toBe(false);
    expect(isNewApiGatewayBaseUrl('aihub.brisnets.com')).toBe(false);
    expect(isNewApiGatewayBaseUrl('')).toBe(false);
  });
});

describe('newApiBillingUrl', () => {
  test('billing endpoints hang off the provider base URL', () => {
    expect(newApiBillingUrl('https://aihub.brisnets.com/v1', 'usage'))
      .toBe('https://aihub.brisnets.com/v1/dashboard/billing/usage');
    expect(newApiBillingUrl('https://aihub.brisnets.com/v1/', 'subscription'))
      .toBe('https://aihub.brisnets.com/v1/dashboard/billing/subscription');
    expect(newApiBillingUrl('https://aihub.brisnets.com', 'usage'))
      .toBe('https://aihub.brisnets.com/v1/dashboard/billing/usage');
  });
});

describe('parseNewApiBilling', () => {
  test('an unlimited token reports spend only, never the sentinel as a limit', () => {
    const windows = parseNewApiBilling(
      'aihub-brisnets-jatis',
      { object: 'list', total_usage: 1365.635 },
      { object: 'billing_subscription', hard_limit_usd: 100_000_000, access_until: 0 },
    );

    expect(windows).toHaveLength(1);
    expect(windows[0].id).toBe('aihub-brisnets-jatis:spent');
    expect(windows[0].unit).toBe('usd');
    expect(windows[0].used).toBeCloseTo(13.65635, 6);
    expect(windows[0].limit).toBeUndefined();
    expect(windows[0].usedFraction).toBeUndefined();
    expect(windows[0].notes?.join(' ')).toContain('gateway console');
  });

  test('a limited token derives the remaining credit from remain+used', () => {
    const [window] = parseNewApiBilling(
      'relay',
      { object: 'list', total_usage: 500 },
      { hard_limit_usd: 20 },
    );

    expect(window.id).toBe('relay:credit');
    expect(window.used).toBe(5);
    expect(window.limit).toBe(20);
    expect(window.remaining).toBe(15);
    expect(window.usedFraction).toBeCloseTo(0.25, 6);
    expect(window.status).toBe('ok');
  });

  test('an exhausted token clamps the remaining credit at zero', () => {
    const [window] = parseNewApiBilling('relay', { total_usage: 2500 }, { hard_limit_usd: 20 });

    expect(window.remaining).toBe(0);
    expect(window.status).toBe('exhausted');
  });

  test('a missing subscription still reports the spend', () => {
    const windows = parseNewApiBilling('relay', { total_usage: 100 }, undefined);
    expect(windows[0].used).toBe(1);
    expect(windows[0].limit).toBeUndefined();
  });

  test('a body without total_usage is a schema change, not an empty balance', () => {
    expect(() => parseNewApiBilling('relay', { object: 'list' })).toThrow('unexpected billing response');
  });
});
