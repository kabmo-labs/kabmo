/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The device split in the terminal's focus target.
 *
 * A phone types into the renderer's textarea (`beforeinput`); a hardware
 * keyboard types into the container (`keydown`). Focusing the container on a
 * phone is what left the keyboard closed and the first characters swallowed, so
 * the two branches are pinned here — including the redirect that survives
 * ghostty's own delayed container focus.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import type { Terminal } from 'ghostty-web';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';
import {
  focusTerminal,
  focusTerminalTextarea,
  redirectSoftKeyboardFocus,
} from '@/client/components/workspace/terminal-panel/focus-target';

let win: Window;
let container: HTMLDivElement;
let textarea: HTMLTextAreaElement;
let containerFocuses = 0;

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

function fakeTerminal(): Terminal {
  return {
    textarea,
    focus() {
      containerFocuses += 1;
      container.focus();
    },
  } as unknown as Terminal;
}

beforeAll(() => {
  win = new Window({ url: 'http://localhost' });
  installDomGlobals(win);
});

afterEach(() => {
  document.body.innerHTML = '';
  containerFocuses = 0;
});

afterAll(() => {
  restoreDomGlobals();
});

function mount(): void {
  container = document.createElement('div');
  container.tabIndex = 0;
  textarea = document.createElement('textarea');
  container.appendChild(textarea);
  document.body.appendChild(container);
}

describe('terminal focus target', () => {
  test('a phone focuses the textarea, not the container', () => {
    mount();
    setSoftKeyboardDevice(true);
    focusTerminal(fakeTerminal());
    expect(document.activeElement).toBe(textarea);
    expect(containerFocuses).toBe(0);
  });

  test('a hardware keyboard focuses the container', () => {
    mount();
    setSoftKeyboardDevice(false);
    focusTerminal(fakeTerminal());
    expect(document.activeElement).toBe(container);
    expect(containerFocuses).toBe(1);
  });

  test('the textarea helper is a no-op on a desktop', () => {
    mount();
    setSoftKeyboardDevice(false);
    focusTerminalTextarea(fakeTerminal());
    expect(document.activeElement).not.toBe(textarea);
  });

  test('a phone redirects the container focus ghostty schedules after open', () => {
    mount();
    setSoftKeyboardDevice(true);
    const stop = redirectSoftKeyboardFocus(container, fakeTerminal());
    container.focus();
    expect(document.activeElement).toBe(textarea);
    stop();
    textarea.blur();
    container.focus();
    expect(document.activeElement).toBe(container);
  });

  test('a desktop keeps the container focus', () => {
    mount();
    setSoftKeyboardDevice(false);
    const stop = redirectSoftKeyboardFocus(container, fakeTerminal());
    container.focus();
    expect(document.activeElement).toBe(container);
    stop();
  });
});
