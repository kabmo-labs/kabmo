/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The soft-keyboard bridge: one focusable element, focused inside the tap.
 *
 * The bug this pins is a phone one: the terminal's focus request lands after the
 * renderer's async mount, which is after the tap that opened the panel, and a
 * phone opens its keyboard only while a gesture is active. The bridge is the
 * element that carries the gesture across that gap, so the assertions are about
 * the three ways it can fail: it is not focusable (a hidden element), it piles
 * up one element per tap, or it steals focus back from the terminal.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';
import {
  openSoftKeyboard,
  releaseSoftKeyboard,
  SOFT_KEYBOARD_BRIDGE_ATTR,
} from '@/client/lib/ui/soft-keyboard';

let win: Window;

function setSoftKeyboardDevice(value: boolean): void {
  win.matchMedia = ((query: string) => ({
    matches: value && query === '(pointer: coarse)',
    media: query,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => false,
  })) as unknown as typeof win.matchMedia;
  Object.defineProperty(win.navigator, 'maxTouchPoints', { value: 0, configurable: true });
}

function bridge(): HTMLTextAreaElement | null {
  return document.querySelector<HTMLTextAreaElement>(`[${SOFT_KEYBOARD_BRIDGE_ATTR}]`);
}

beforeAll(() => {
  win = new Window({ url: 'http://localhost' });
  installDomGlobals(win);
});

afterEach(() => {
  releaseSoftKeyboard();
  document.body.innerHTML = '';
});

afterAll(() => {
  restoreDomGlobals();
});

describe('soft keyboard bridge', () => {
  test('focuses a real, offscreen textarea on a soft-keyboard device', () => {
    setSoftKeyboardDevice(true);
    openSoftKeyboard();

    const element = bridge();
    expect(element).not.toBeNull();
    expect(document.activeElement).toBe(element);
    // `display:none`/`visibility:hidden` cannot take focus, and a font below
    // 16px makes iOS zoom the page when the keyboard opens.
    expect(element!.style.display).not.toBe('none');
    expect(element!.style.visibility).not.toBe('hidden');
    expect(element!.style.fontSize).toBe('16px');
  });

  test('reuses one bridge across taps', () => {
    setSoftKeyboardDevice(true);
    openSoftKeyboard();
    openSoftKeyboard();
    expect(document.querySelectorAll(`[${SOFT_KEYBOARD_BRIDGE_ATTR}]`).length).toBe(1);
  });

  test('release blurs the bridge but never steals focus from the terminal', () => {
    setSoftKeyboardDevice(true);
    openSoftKeyboard();
    releaseSoftKeyboard();
    expect(document.activeElement).not.toBe(bridge());

    const terminal = document.createElement('div');
    terminal.tabIndex = 0;
    document.body.appendChild(terminal);
    terminal.focus();
    releaseSoftKeyboard();
    expect(document.activeElement).toBe(terminal);
  });

  test('does nothing on a device with a hardware keyboard', () => {
    setSoftKeyboardDevice(false);
    const before = document.activeElement;
    openSoftKeyboard();
    expect(bridge()).toBeNull();
    expect(document.activeElement).toBe(before);
  });
});
