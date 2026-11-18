/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The terminal's copy paths.
 *
 * A browser delivers ⌘C as a keydown ghostty-web handles itself, but two
 * platforms do not: the macOS shell's Edit menu claims the chord and the page
 * only sees the native `copy:` action's DOM `copy` event, while Windows and
 * Linux use `Ctrl+Shift+C` and `Ctrl+Shift+V` (ghostty-web binds neither). Both
 * paths are pinned here, including the empty-selection case that must stay the
 * platform's business and the capture-phase `stopImmediatePropagation` that
 * keeps the chord out of the PTY encoder.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';
import {
  installTerminalCopy,
  installTerminalCopyChords,
} from '@/client/components/workspace/terminal-panel/copy';

let win: Window;
let container: HTMLDivElement;

beforeAll(() => {
  win = new Window();
  installDomGlobals(win);
});

afterEach(() => {
  document.body.innerHTML = '';
});

afterAll(() => {
  restoreDomGlobals();
});

function mount(): void {
  container = document.createElement('div');
  document.body.appendChild(container);
}

function installClipboard(written: string[], pasted: string): void {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: async (text: string) => void written.push(text),
      readText: async () => pasted,
    },
  });
  // happy-dom leaves `isSecureContext` undefined, and the clipboard helper
  // refuses the async API without it.
  Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
}

function copyEvent(): { event: Event; data: Map<string, string> } {
  const data = new Map<string, string>();
  const event = new Event('copy', { cancelable: true }) as unknown as Event & {
    clipboardData: { setData: (type: string, value: string) => void };
  };
  event.clipboardData = { setData: (type, value) => data.set(type, value) };
  return { event, data };
}

function chord(code: string, key: string): KeyboardEvent {
  return new win.KeyboardEvent('keydown', {
    key,
    code,
    ctrlKey: true,
    shiftKey: true,
    cancelable: true,
    bubbles: true,
  }) as unknown as KeyboardEvent;
}

describe('terminal copy event', () => {
  test('writes the terminal selection and suppresses the DOM copy', () => {
    mount();
    const dispose = installTerminalCopy(container, () => 'line one\nline two');
    const { event, data } = copyEvent();
    container.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(data.get('text/plain')).toBe('line one\nline two');
    dispose();
  });

  test('leaves an empty selection to the platform', () => {
    mount();
    const dispose = installTerminalCopy(container, () => '');
    const { event, data } = copyEvent();
    container.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(data.size).toBe(0);
    dispose();
  });

  test('the disposer removes the listener', () => {
    mount();
    const dispose = installTerminalCopy(container, () => 'x');
    dispose();
    const { event, data } = copyEvent();
    container.dispatchEvent(event);
    expect(data.size).toBe(0);
  });
});

describe('terminal copy chords', () => {
  test('Ctrl+Shift+C copies the selection and never reaches the PTY encoder', async () => {
    mount();
    const written: string[] = [];
    installClipboard(written, '');
    const dispose = installTerminalCopyChords(container, {
      getSelection: () => 'chord selection',
      paste: () => {},
    });
    let reachedEncoder = false;
    container.addEventListener('keydown', () => { reachedEncoder = true; });
    const event = chord('KeyC', 'c');
    container.dispatchEvent(event);
    await Promise.resolve();
    expect(event.defaultPrevented).toBe(true);
    expect(reachedEncoder).toBe(false);
    expect(written).toEqual(['chord selection']);
    dispose();
  });

  test('Ctrl+Shift+C with no selection stays out of the way', () => {
    mount();
    const written: string[] = [];
    installClipboard(written, '');
    const dispose = installTerminalCopyChords(container, {
      getSelection: () => '',
      paste: () => {},
    });
    const event = chord('KeyC', 'c');
    container.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(written).toEqual([]);
    dispose();
  });

  test('Ctrl+Shift+V pastes the clipboard into the terminal', async () => {
    mount();
    const written: string[] = [];
    installClipboard(written, 'clipboard text');
    const pasted: string[] = [];
    const dispose = installTerminalCopyChords(container, {
      getSelection: () => '',
      paste: (text) => void pasted.push(text),
    });
    const event = chord('KeyV', 'v');
    container.dispatchEvent(event);
    await Promise.resolve();
    await Promise.resolve();
    expect(event.defaultPrevented).toBe(true);
    expect(pasted).toEqual(['clipboard text']);
    dispose();
  });

  test('the disposer removes both chords', async () => {
    mount();
    const written: string[] = [];
    installClipboard(written, 'clipboard text');
    const dispose = installTerminalCopyChords(container, {
      getSelection: () => 'chord selection',
      paste: () => {},
    });
    dispose();
    const event = chord('KeyC', 'c');
    container.dispatchEvent(event);
    await Promise.resolve();
    expect(event.defaultPrevented).toBe(false);
    expect(written).toEqual([]);
  });
});
