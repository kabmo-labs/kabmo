/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Opening and saving a file the operating system handed over.
 *
 * The claims here are the ones that make a launched file different from every
 * other file in Kabmo:
 *
 * - It is refused for its KIND before a tab opens, because there is no route to
 *   ask that question for a `FileSystemFileHandle`.
 * - Its Save goes through the live handle and NEVER through `/api/fs/action` —
 *   its `path` is only a display name, and posting that would write an
 *   unrelated file.
 * - A handle that is gone (a page reload) is a REFUSAL, not a fallback, so a
 *   Save cannot silently land somewhere else.
 *
 * Driven through happy-dom, following `use-editor-drop.test.ts`.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import {
  fileHandleFor,
  fileHandlingSupported,
  installFileLaunchHandler,
  openLaunchedHandle,
  writeThroughHandle,
} from '@/client/lib/launch/file-handlers';
import { BINARY_SNIFF_BYTES } from '@/shared/lib/fs/file-kind';

const DOM_GLOBALS = ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'Event', 'CustomEvent', 'MouseEvent', 'KeyboardEvent', 'fetch'] as const;
const nativeGlobals: Partial<Record<(typeof DOM_GLOBALS)[number], unknown>> = {};

let opened: { path: string; name?: string; content?: string; handleId?: string }[] = [];
let fetchCalls: string[] = [];

beforeAll(() => {
  const win = new Window({ url: 'http://localhost' });
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    nativeGlobals[key] = target[key];
    target[key] = (win as unknown as Record<string, unknown>)[key];
  }
  globalThis.fetch = (async (url: string) => {
    fetchCalls.push(String(url));
    throw new Error('the handle path must not fetch');
  }) as unknown as typeof globalThis.fetch;
  win.addEventListener('omp:open-file', (event) => {
    opened.push((event as unknown as CustomEvent).detail);
  });
});

afterAll(() => {
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (nativeGlobals[key] === undefined) delete target[key];
    else target[key] = nativeGlobals[key];
  }
});

/** A handle over `bytes`, recording what a write puts through it. */
function fakeHandle(name: string, bytes: Uint8Array, options: { readwrite?: PermissionState } = {}) {
  const writes: string[] = [];
  const requests: string[] = [];
  let state: PermissionState = options.readwrite ?? 'granted';
  const handle = {
    name,
    kind: 'file',
    async getFile() {
      return new File([bytes], name);
    },
    async queryPermission(descriptor?: { mode?: string }) {
      return descriptor?.mode === 'readwrite' ? state : 'granted';
    },
    async requestPermission(descriptor?: { mode?: string }) {
      requests.push(descriptor?.mode ?? 'read');
      // The real API needs USER ACTIVATION: it throws without a gesture rather
      // than prompting. The test models that by reading a flag the harness sets.
      if (!userActivation()) throw new DOMException('User activation is required', 'SecurityError');
      if (descriptor?.mode === 'readwrite') state = 'granted';
      return state;
    },
    async createWritable() {
      // The real API REFUSES while readwrite is not granted.
      if (state !== 'granted') throw new Error('Permission denied');
      return {
        async write(data: string) {
          writes.push(data);
        },
        async close() {},
      };
    },
  };
  return { handle: handle as unknown as FileSystemFileHandle, writes, requests };
}

/** Whether the current fake call stands for a user gesture. Set per test. */
let gestureActive = false;
function userActivation(): boolean {
  return gestureActive;
}

describe('launch file handlers', () => {
  beforeEach(() => {
    opened = [];
    fetchCalls = [];
    gestureActive = false;
  });

  test('a text file opens as a tab with its bytes and a handle id', async () => {
    const { handle } = fakeHandle('notes.md', new TextEncoder().encode('# hi\n'));
    const result = await openLaunchedHandle(handle);

    expect(result.ok).toBe(true);
    expect(opened).toHaveLength(1);
    expect(opened[0].content).toBe('# hi\n');
    expect(opened[0].handleId).toBeTruthy();
    // No server round trip: a handle names no reachable path.
    expect(fetchCalls).toHaveLength(0);
  });

  test('a binary file is refused before any tab opens', async () => {
    const bytes = new Uint8Array(BINARY_SNIFF_BYTES);
    bytes[0] = 0x50;
    bytes[1] = 0x4b;
    bytes[2] = 0x00;
    const { handle } = fakeHandle('archive.zip', bytes);
    const result = await openLaunchedHandle(handle);

    expect(result.ok).toBe(false);
    expect(result.message).toContain('not text');
    expect(opened).toHaveLength(0);
  });

  test('the handle registered at open is the one a save writes through', async () => {
    const { handle, writes } = fakeHandle('notes.md', new TextEncoder().encode('# hi\n'));
    await openLaunchedHandle(handle);
    const handleId = opened[0].handleId!;

    expect(fileHandleFor(handleId)).not.toBeNull();
    // An already-granted handle needs no gesture, so the autosave path works.
    expect(await writeThroughHandle(handleId, '# edited\n', { interactive: false })).toBe('written');
    expect(writes).toEqual(['# edited\n']);
  });

  test('an interactive save asks for readwrite when the handle only starts at prompt', async () => {
    // Measured on Chrome for macOS: a dropped handle is `read: granted` /
    // `readwrite: prompt`, and `createWritable` REFUSES while it is `prompt`.
    // Without the request the Save silently did nothing.
    const { handle, writes, requests } = fakeHandle(
      'dropped.ts',
      new TextEncoder().encode('a\n'),
      { readwrite: 'prompt' },
    );
    await openLaunchedHandle(handle);
    const handleId = opened[0].handleId!;

    gestureActive = true; // the click that invoked the save
    expect(await writeThroughHandle(handleId, 'b\n', { interactive: true })).toBe('written');
    expect(requests).toEqual(['readwrite']);
    expect(writes).toEqual(['b\n']);
  });

  test('a NON-interactive write reports needs-permission instead of prompting', async () => {
    // The autosave fires from a timer, with no user gesture. Asking for
    // readwrite there is refused by the browser, so the honest answer is "the
    // user has to click Save" — not a failed save and not a hung prompt.
    const { handle, writes, requests } = fakeHandle(
      'dropped.ts',
      new TextEncoder().encode('a\n'),
      { readwrite: 'prompt' },
    );
    await openLaunchedHandle(handle);
    const handleId = opened[0].handleId!;

    gestureActive = false;
    expect(await writeThroughHandle(handleId, 'b\n', { interactive: false })).toBe('needs-permission');
    expect(requests).toEqual([]);
    expect(writes).toEqual([]);
  });

  test('a refused permission is a failed save, never a silent one', async () => {
    const { handle, writes } = fakeHandle(
      'locked.ts',
      new TextEncoder().encode('a\n'),
      { readwrite: 'prompt' },
    );
    await openLaunchedHandle(handle);
    const handleId = opened[0].handleId!;

    // Gesture present, but the handle still does not grant: `requestPermission`
    // throws without activation, and the write must report failure.
    gestureActive = false;
    expect(await writeThroughHandle(handleId, 'b\n', { interactive: true })).toBe('failed');
    expect(writes).toEqual([]);
  });

  test('a write through a handle the page no longer holds is refused', async () => {
    // The reload case: the map is empty, so the id names nothing. A fallback to
    // the path-based save would write an unrelated file.
    expect(fileHandleFor('launch-9999')).toBeNull();
    expect(await writeThroughHandle('launch-9999', 'x', { interactive: true })).toBe('failed');
    expect(fetchCalls).toHaveLength(0);
  });

  // A picture and a document reach the editor through their live handle now:
  // the byte source reads the bytes and the viewer wraps them in an object URL,
  // so no server path is needed. The tab opens with a `handleId` and NO inline
  // content (a binary read into a string would corrupt it).
  test('a launched image opens through its handle, with no inline content', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const { handle } = fakeHandle('shot.png', png);
    const result = await openLaunchedHandle(handle);

    expect(result.ok).toBe(true);
    expect(opened).toHaveLength(1);
    expect(opened[0].name).toBe('shot.png');
    // No `content`: the viewer reads the bytes itself, and a PNG decoded as text
    // is replacement characters.
    expect(opened[0].content).toBeUndefined();
    expect(opened[0].handleId).toBeTruthy();
  });

  test('a launched document opens through its handle, with no inline content', async () => {
    // A minimal PDF signature is enough: the classifier exempts documents from
    // the NUL sniff, so the bytes are not read into the buffer.
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);
    const { handle } = fakeHandle('report.pdf', pdf);
    const result = await openLaunchedHandle(handle);

    expect(result.ok).toBe(true);
    expect(opened[0].name).toBe('report.pdf');
    expect(opened[0].content).toBeUndefined();
  });

  test('a launched text file still opens with its content in the buffer', async () => {
    const { handle } = fakeHandle('notes.txt', new TextEncoder().encode('hello\n'));
    const result = await openLaunchedHandle(handle);

    expect(result.ok).toBe(true);
    expect(opened[0].content).toBe('hello\n');
  });

  test('a browser without launchQueue reports no support and installs nothing', () => {
    // The DOM lib in this environment has no `launchQueue`, which is exactly
    // the Firefox/Safari case.
    expect(fileHandlingSupported()).toBe(false);
    const uninstall = installFileLaunchHandler();
    expect(typeof uninstall).toBe('function');
    uninstall();
  });
});
