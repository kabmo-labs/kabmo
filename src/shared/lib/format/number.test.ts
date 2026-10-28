/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The Kabmo's shared number formatters.
 *
 * These decide what a token count, a cost, a byte size and a per-1M price look
 * like on every surface, so the boundaries are the contract: `formatCompactTokens`
 * switches at 1000 and 1_000_000 with decimal units (1500 → "1.5K", 1048576 →
 * "1.0M"), passes preformatted strings through untouched, and returns undefined
 * for non-positive/non-finite input so callers can apply their own fallback.
 * `formatCost`/`formatBytes`/`formatPrice` must return an EMPTY string — not
 * "$0.00"/"0 B" — for missing values, except that a real price of 0 is a valid
 * "$0.00". Pinning the empty-vs-zero split stops a "nicer default" from
 * inventing a cost the model never charged.
 */

import { describe, expect, test } from 'bun:test';

import { formatBytes, formatCompactTokens, formatCost, formatPrice } from '@/shared/lib/format/number';

describe('formatCompactTokens', () => {
  test('passes already-formatted strings through, including the empty string', () => {
    expect(formatCompactTokens('1.5K')).toBe('1.5K');
    expect(formatCompactTokens('')).toBe('');
  });

  test('returns undefined for null, undefined and invalid numbers', () => {
    expect(formatCompactTokens(null)).toBeUndefined();
    expect(formatCompactTokens(undefined)).toBeUndefined();
    expect(formatCompactTokens(0)).toBeUndefined();
    expect(formatCompactTokens(-5)).toBeUndefined();
    expect(formatCompactTokens(Number.NaN)).toBeUndefined();
    expect(formatCompactTokens(Number.POSITIVE_INFINITY)).toBeUndefined();
  });

  test('keeps small counts verbatim', () => {
    expect(formatCompactTokens(1)).toBe('1');
    expect(formatCompactTokens(999)).toBe('999');
    expect(formatCompactTokens(1.5)).toBe('1.5');
  });

  test('switches to K at exactly 1000, with a trailing zero only when needed', () => {
    expect(formatCompactTokens(1000)).toBe('1K');
    expect(formatCompactTokens(1500)).toBe('1.5K');
    expect(formatCompactTokens(131_072)).toBe('131.1K');
    expect(formatCompactTokens(999_999)).toBe('1000.0K');
  });

  test('switches to M at exactly 1_000_000', () => {
    expect(formatCompactTokens(1_000_000)).toBe('1M');
    expect(formatCompactTokens(1_048_576)).toBe('1.0M');
    expect(formatCompactTokens(2_000_000)).toBe('2M');
    expect(formatCompactTokens(1_000_000_000)).toBe('1000M');
  });
});

describe('formatCost', () => {
  test('renders two decimals by default', () => {
    expect(formatCost(1.234)).toBe('$1.23');
    expect(formatCost(2)).toBe('$2.00');
    expect(formatCost(0.5)).toBe('$0.50');
  });

  test('honours a raised fraction-digit count for sub-cent costs', () => {
    expect(formatCost(0.001, 4)).toBe('$0.0010');
    expect(formatCost(12.6, 0)).toBe('$13');
  });

  test('an empty string marks a missing or non-positive cost', () => {
    expect(formatCost(0)).toBe('');
    expect(formatCost(-1)).toBe('');
    expect(formatCost(Number.NaN)).toBe('');
    expect(formatCost(undefined)).toBe('');
    expect(formatCost(null)).toBe('');
    expect(formatCost('1' as unknown as number)).toBe('');
  });
});

describe('formatBytes', () => {
  test('renders bytes below 1 KiB as rounded whole bytes', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1.5)).toBe('2 B');
    expect(formatBytes(1023.4)).toBe('1023 B');
  });

  test('switches to KB at exactly 1024', () => {
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(1_048_575)).toBe('1024.0 KB');
  });

  test('switches to MB at exactly 1 MiB', () => {
    expect(formatBytes(1_048_576)).toBe('1.00 MB');
    expect(formatBytes(2 * 1024 * 1024)).toBe('2.00 MB');
  });

  test('an empty string marks missing, non-finite or negative sizes', () => {
    expect(formatBytes(-1)).toBe('');
    expect(formatBytes(Number.NaN)).toBe('');
    expect(formatBytes(Number.POSITIVE_INFINITY)).toBe('');
    expect(formatBytes(undefined)).toBe('');
    expect(formatBytes(null)).toBe('');
  });
});

describe('formatPrice', () => {
  test('renders a per-1M price with two decimals', () => {
    expect(formatPrice(3)).toBe('$3.00');
    expect(formatPrice(3.5)).toBe('$3.50');
    expect(formatPrice(1.239)).toBe('$1.24');
  });

  test('zero is a valid free price, not a missing one', () => {
    expect(formatPrice(0)).toBe('$0.00');
  });

  test('an empty string marks a missing or negative price', () => {
    expect(formatPrice(-1)).toBe('');
    expect(formatPrice(Number.NaN)).toBe('');
    expect(formatPrice(Number.POSITIVE_INFINITY)).toBe('');
    expect(formatPrice(undefined)).toBe('');
  });
});
