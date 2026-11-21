/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The phone's chrome row is ONE fact.
 *
 * Six phone title bars stated their own height, notch and window insets, and
 * they had already drifted: the chat header and both drawers were `3.5rem` while
 * the editor and the diff were `3rem`, so opening a file moved the back control
 * 8px and the row read as a different window. These cases pin the shared
 * declarations, so a surface that goes back to writing its own loses the notch
 * or the shell inset and fails here rather than in a screenshot.
 */

import { describe, expect, test } from 'bun:test';
import { PHONE_ROW_HEIGHT, phoneFrameStyle, phoneRowStyle } from '@/client/lib/ui/phone-row';

describe('the phone row', () => {
  test('the height carries the notch, and the padding reserves it too', () => {
    // Height AND padding are both load-bearing with border-box: height alone
    // pins the controls to y=0 (under the status bar), padding alone is eaten
    // out of the row and squeezes them into a 16px content box.
    expect(PHONE_ROW_HEIGHT).toBe('calc(3.5rem + env(safe-area-inset-top, 0px))');
    const style = phoneRowStyle();
    expect(style.height).toBe(PHONE_ROW_HEIGHT);
    expect(style.paddingTop).toBe('env(safe-area-inset-top, 0px)');
  });

  test('both edges clear the safe area and the window controls', () => {
    const style = phoneRowStyle();
    expect(style.paddingLeft).toContain('env(safe-area-inset-left, 0px)');
    expect(style.paddingLeft).toContain('env(titlebar-area-x, 0px)');
    expect(style.paddingRight).toContain('env(safe-area-inset-right, 0px)');
    expect(style.paddingRight).toContain('env(titlebar-area-width, 100vw)');
  });

  test('a full-screen frame takes the insets and NOT the height', () => {
    // A `h-dvh` dialog is the viewport, not a row: the row height here would
    // make the whole sheet 56px tall.
    const style = phoneFrameStyle();
    expect(style.height).toBeUndefined();
    expect(style.paddingTop).toBe('env(safe-area-inset-top, 0px)');
    expect(style.paddingLeft).toContain('env(titlebar-area-x, 0px)');
  });

  test('the caller can state its own horizontal base', () => {
    expect(phoneRowStyle('1rem').paddingLeft).toContain('1rem');
    expect(phoneFrameStyle('1rem').paddingLeft).toContain('1rem');
  });
});
