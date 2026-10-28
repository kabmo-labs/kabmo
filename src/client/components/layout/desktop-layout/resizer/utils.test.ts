/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, test } from 'bun:test';

import { transfer } from '@/client/components/layout/desktop-layout/resizer/utils';

describe('transfer', () => {
  test('growing the leading panel stops at its own ceiling', () => {
    expect(transfer({ size: 600, min: 300, max: 1200 }, { size: 1200, min: 320, max: 1200 }, 900)).toBe(600);
  });

  test('growing the leading panel stops at the trailing floor', () => {
    expect(transfer({ size: 600, min: 300, max: 1200 }, { size: 268, min: 200, max: 1200 }, 900)).toBe(68);
  });

  test('shrinking the leading panel stops at its own floor', () => {
    expect(transfer({ size: 420, min: 420, max: Number.MAX_SAFE_INTEGER }, { size: 300, min: 300, max: 1200 }, -500)).toBe(0);
  });

  test('a trailing panel parked on its floor still lets the leading one shrink', () => {
    // The editor sat at its 300px floor, which used to clamp every negative
    // delta to 0: the separator went dead and the layout could not be dragged
    // back out of that state.
    expect(transfer({ size: 1520, min: 420, max: Number.MAX_SAFE_INTEGER }, { size: 300, min: 300, max: 1200 }, -1600)).toBe(-900);
  });

  test('a delta inside both panels has room passes through', () => {
    expect(transfer({ size: 600, min: 300, max: 1200 }, { size: 640, min: 320, max: 1200 }, -100)).toBe(-100);
  });
});
