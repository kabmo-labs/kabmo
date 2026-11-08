/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, test } from 'bun:test';
import { DIALOG_GUTTER_REM, safeAreaPadding } from '@/shared/lib/ui/safe-area';

describe('safeAreaPadding', () => {
  test('every edge takes the LARGER of the gutter and the device inset', () => {
    // `max()`, never a sum: a notched phone would otherwise get gutter + inset,
    // which is twice the clearance the dialog needs.
    const style = safeAreaPadding();
    expect(style.paddingTop).toBe(`max(${DIALOG_GUTTER_REM}rem, env(safe-area-inset-top, 0px))`);
    expect(style.paddingBottom).toBe(`max(${DIALOG_GUTTER_REM}rem, env(safe-area-inset-bottom, 0px))`);
    expect(style.paddingLeft).toBe(`max(${DIALOG_GUTTER_REM}rem, env(safe-area-inset-left, 0px))`);
    expect(style.paddingRight).toBe(`max(${DIALOG_GUTTER_REM}rem, env(safe-area-inset-right, 0px))`);
  });

  test('a caller with its own gutter keeps it on all four edges', () => {
    const style = safeAreaPadding(1);
    expect(style.paddingTop).toBe('max(1rem, env(safe-area-inset-top, 0px))');
    expect(style.paddingBottom).toBe('max(1rem, env(safe-area-inset-bottom, 0px))');
    // Both horizontal edges, because a landscape phone's notch is on a SIDE.
    expect(style.paddingLeft).toBe('max(1rem, env(safe-area-inset-left, 0px))');
    expect(style.paddingRight).toBe('max(1rem, env(safe-area-inset-right, 0px))');
  });
});
