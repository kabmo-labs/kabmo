/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The one runtime guard both bundles share.
 *
 * `isRecord` is used to validate untrusted tool arguments, so the cases that
 * matter are the ones it must REJECT: `null` (typeof 'object'!), arrays, and
 * primitives. Pinning that arrays and null are not records stops a caller from
 * indexing a list as if it were a map. It is a shallow `typeof` check by design,
 * so a class instance (e.g. a `Date`) passes — documented here rather than
 * assumed.
 */

import { describe, expect, test } from 'bun:test';

import { isRecord } from '@/shared/lib/util/guards';

describe('isRecord', () => {
  test('accepts plain and null-prototype objects', () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord({ a: 1 })).toBe(true);
    expect(isRecord(Object.create(null))).toBe(true);
  });

  test('rejects null and undefined', () => {
    expect(isRecord(null)).toBe(false);
    expect(isRecord(undefined)).toBe(false);
  });

  test('rejects arrays, even empty ones', () => {
    expect(isRecord([])).toBe(false);
    expect(isRecord([1, 2])).toBe(false);
  });

  test('rejects primitives and functions', () => {
    expect(isRecord('text')).toBe(false);
    expect(isRecord(1)).toBe(false);
    expect(isRecord(true)).toBe(false);
    expect(isRecord(() => {})).toBe(false);
  });

  test('is a shallow typeof check, so class instances pass', () => {
    expect(isRecord(new Date())).toBe(true);
  });
});
