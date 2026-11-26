/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, test } from 'bun:test';
import { formatSpan } from './duration';

describe('formatSpan', () => {
  test('prints sub-second spans to one decimal', () => {
    expect(formatSpan(420)).toBe('0.4s');
    expect(formatSpan(1500)).toBe('1.5s');
  });

  test('drops the decimal from ten seconds up', () => {
    expect(formatSpan(9_999)).toBe('10.0s');
    expect(formatSpan(12_000)).toBe('12s');
  });

  test('uses the largest two units past a minute', () => {
    expect(formatSpan(134_000)).toBe('2m 14s');
    expect(formatSpan(3_840_000)).toBe('1h 4m');
  });

  test('returns undefined for a value it cannot state', () => {
    expect(formatSpan(undefined)).toBeUndefined();
    expect(formatSpan(0)).toBeUndefined();
    expect(formatSpan(-5)).toBeUndefined();
    expect(formatSpan(Number.NaN)).toBeUndefined();
  });
});
