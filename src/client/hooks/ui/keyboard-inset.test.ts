/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The keyboard-inset arithmetic.
 *
 * The failure this file exists for is an OVER-lift: computing the keyboard's
 * height from `innerHeight - visualHeight` and applying it to a panel that does
 * not reach the screen's bottom edge (a drawer with safe-area padding, a
 * container a browser already shrank) lifts by the keyboard's height PLUS the
 * gap the panel never had. Deriving the lift from the panel's own overlap makes
 * every one of those cases zero.
 */

import { describe, expect, test } from 'bun:test';

import { resolveKeyboardInset } from '@/client/hooks/ui/keyboard-inset';

describe('resolveKeyboardInset', () => {
  test('a panel that clears the visible bottom is not lifted', () => {
    // Keyboard open, panel already above it: nothing to do.
    expect(resolveKeyboardInset(500, 508)).toBe(0);
    expect(resolveKeyboardInset(508, 508)).toBe(0);
  });

  test('a collapsed URL bar is not a keyboard', () => {
    expect(resolveKeyboardInset(844, 780)).toBe(0);
    expect(resolveKeyboardInset(844, 765)).toBe(0);
  });

  test('the lift is the overlap, not the keyboard height', () => {
    // Panel bottom at 844, visible bottom at 508 -> 336px covered.
    expect(resolveKeyboardInset(844, 508)).toBe(336);
    // The same keyboard over a panel that ends 20px higher lifts 20px less,
    // which is exactly the over-lift the height-difference form produced.
    expect(resolveKeyboardInset(824, 508)).toBe(316);
    expect(resolveKeyboardInset(508, 508)).toBe(0);
  });

  test('a nonsense visible bottom lifts nothing', () => {
    expect(resolveKeyboardInset(844, 0)).toBe(0);
    expect(resolveKeyboardInset(844, -100)).toBe(0);
  });
});
