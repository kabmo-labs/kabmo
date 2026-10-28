/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Visibility-driven polling, the clipboard, and the open-file event.
 *
 * The visibility-driven poller this file used to cover is gone with the polls
 * it served: every data-backed panel reads a realtime topic now.
 *
 * Clipboard has two paths — the async API only in a secure context, otherwise
 * the `execCommand` textarea — and neither may silently report success.
 */

import { afterAll, afterEach, beforeAll, describe, expect, jest, test } from 'bun:test';
import { Window } from 'happy-dom';

import { copyToClipboard, readClipboardText } from '@/client/hooks/ui/clipboard';
import { openFileInEditor } from '@/client/hooks/ui/open-file';
import type { OpenFilePayload } from '@/client/hooks/ui/open-file';

const DOM_GLOBALS = ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'Event', 'CustomEvent'] as const;
/** The runner's own globals, restored on teardown (see the matching afterAll at the end of this file) so later files still see native Event/CustomEvent/window. */
const nativeGlobals: Partial<Record<(typeof DOM_GLOBALS)[number], unknown>> = {};

let win: Window;

beforeAll(() => {
  win = new Window({ url: 'http://localhost' });
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (!(key in nativeGlobals)) nativeGlobals[key] = target[key];
    target[key] = (win as unknown as Record<string, unknown>)[key];
  }
});

afterEach(() => {
  document.body.innerHTML = '';
  jest.useRealTimers();
});

function setSecureContext(value: boolean) {
  Object.defineProperty(win, 'isSecureContext', { configurable: true, value });
}

function setClipboard(api: Partial<Clipboard> | undefined) {
  Object.defineProperty(win.navigator, 'clipboard', { configurable: true, value: api });
}

describe('copyToClipboard', () => {
  test('empty text is refused before touching the clipboard', async () => {
    const writes: string[] = [];
    setSecureContext(true);
    setClipboard({ writeText: async (text: string) => void writes.push(text) } as unknown as Clipboard);

    expect(await copyToClipboard('')).toBe(false);
    expect(writes).toEqual([]);
  });

  test('a secure context with the async API returns true and writes the text', async () => {
    const writes: string[] = [];
    setSecureContext(true);
    setClipboard({ writeText: async (text: string) => void writes.push(text) } as unknown as Clipboard);

    expect(await copyToClipboard('hello')).toBe(true);
    expect(writes).toEqual(['hello']);
  });

  test('an insecure context skips the async API and uses the textarea fallback', async () => {
    const writes: string[] = [];
    setSecureContext(false);
    setClipboard({ writeText: async (text: string) => void writes.push(text) } as unknown as Clipboard);
    const commands: string[] = [];
    document.execCommand = ((command: string) => {
      commands.push(command);
      return true;
    }) as typeof document.execCommand;

    expect(await copyToClipboard('hello')).toBe(true);
    expect(writes).toEqual([]);
    expect(commands).toEqual(['copy']);
    // The scratch textarea never outlives the call on the success path.
    expect(document.body.querySelector('textarea')).toBeNull();
  });

  test('a rejected writeText falls back to the textarea', async () => {
    setSecureContext(true);
    setClipboard({ writeText: async () => Promise.reject(new Error('denied')) } as unknown as Clipboard);
    document.execCommand = (() => true) as typeof document.execCommand;

    expect(await copyToClipboard('hello')).toBe(true);
  });

  test('a refused or throwing execCommand reports false', async () => {
    setSecureContext(false);
    setClipboard(undefined);
    document.execCommand = (() => false) as typeof document.execCommand;
    expect(await copyToClipboard('hello')).toBe(false);

    document.execCommand = (() => {
      throw new Error('blocked');
    }) as typeof document.execCommand;
    expect(await copyToClipboard('hello')).toBe(false);
  });
});

describe('readClipboardText', () => {
  test('returns null without the async API', async () => {
    setSecureContext(true);
    setClipboard(undefined);
    expect(await readClipboardText()).toBeNull();
  });

  test('returns null in an insecure context even when the API exists', async () => {
    setSecureContext(false);
    setClipboard({ readText: async () => 'secret' } as unknown as Clipboard);
    expect(await readClipboardText()).toBeNull();
  });

  test('returns the text, and null when the read is refused', async () => {
    setSecureContext(true);
    setClipboard({ readText: async () => 'pasted' } as unknown as Clipboard);
    expect(await readClipboardText()).toBe('pasted');

    setClipboard({ readText: async () => Promise.reject(new Error('denied')) } as unknown as Clipboard);
    expect(await readClipboardText()).toBeNull();
  });
});

describe('openFileInEditor', () => {
  function capture(): OpenFilePayload[] {
    const seen: OpenFilePayload[] = [];
    window.addEventListener('omp:open-file', (event) => {
      seen.push((event as CustomEvent<OpenFilePayload>).detail);
    });
    return seen;
  }

  test('a bare path is cleaned and its basename becomes the name', () => {
    const seen = capture();
    openFileInEditor('/src/client/App.tsx');

    expect(seen).toEqual([
      { path: 'src/client/App.tsx', name: 'App.tsx', id: undefined, content: undefined, root: undefined, repo: undefined },
    ]);
  });

  test('an explicit name wins over the basename, and the payload is forwarded', () => {
    const seen = capture();
    openFileInEditor({ path: '/repo/src/b.ts', name: 'Renamed', id: 7, content: 'x', root: '/repo', repo: 'sub' });

    expect(seen).toEqual([
      { path: 'repo/src/b.ts', name: 'Renamed', id: 7, content: 'x', root: '/repo', repo: 'sub' },
    ]);
  });

  test('a path with no slash keeps the whole path as the name', () => {
    const seen = capture();
    openFileInEditor('README.md');
    expect(seen[0].name).toBe('README.md');
    expect(seen[0].path).toBe('README.md');
  });
});

afterAll(() => {
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (nativeGlobals[key] === undefined) delete target[key];
    else target[key] = nativeGlobals[key];
  }
});
