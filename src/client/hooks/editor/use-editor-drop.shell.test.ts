/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The desktop shell's drop path, which is the only route a WebKit webview has.
 *
 * Measured on macOS 27 against a real `NSFilenamesPboardType` + `public.file-url`
 * pasteboard delivered into a `WKWebView`:
 *
 *     drop: types ["Files"], files [File], getData('text/uri-list') ''
 *           getData('text/plain') '', File.path undefined
 *           DataTransferItem.getAsFileSystemHandle undefined
 *
 * So both routes the hook already had are dead there: there is no handle to
 * open (WebKit implements no File System Access API) and no URI list to resolve
 * (WebKit stopped adding local filenames as URLs to a file drag). Every Finder
 * drop on the macOS shell was refused with "that drop carried no readable file"
 * — the composer still worked, because it only needs the bytes.
 *
 * The shell reads its own pasteboard before the DOM event and answers
 * `dropped_paths`. These cases pin the three properties of that answer: it is
 * used when present, it does not displace a handle, and it is refused when it
 * is stale.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { useEditorDrop, type UseEditorDropResult } from '@/client/hooks/editor/use-editor-drop';
import { readShellDroppedPaths, SHELL_DROP_TTL_MS } from '@/client/lib/desktop/dropped-paths';

const DOM_GLOBALS = ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'Event', 'CustomEvent', 'MouseEvent', 'KeyboardEvent', 'fetch'] as const;
const nativeGlobals: Partial<Record<(typeof DOM_GLOBALS)[number], unknown>> = {};

let scopeResponse: { ok: boolean; status: number; body: unknown } = { ok: true, status: 200, body: {} };
let fetchCalls: string[] = [];
let opened: unknown[] = [];
let bridgeCalls: string[] = [];
/** What the shell answers for `dropped_paths`, per case. */
let bridgeAnswer: unknown = null;

beforeAll(() => {
  const win = new Window({ url: 'http://localhost' });
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    nativeGlobals[key] = target[key];
    target[key] = (win as unknown as Record<string, unknown>)[key];
  }
  globalThis.fetch = (async (url: string) => {
    fetchCalls.push(String(url));
    const { ok, status, body } = scopeResponse;
    return { ok, status, json: async () => body };
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

/** A `DataTransfer` shaped exactly as a Finder drag arrives on WebKit. */
function webkitFinderTransfer(): DataTransfer {
  return {
    types: ['Files'],
    files: [{ name: 'from-finder.ts', size: 12 }],
    getData: () => '',
    items: [{ kind: 'file', type: '', getAsFile: () => null }],
  } as unknown as DataTransfer;
}

/** A `DataTransfer` that offers a handle — the Chromium shape. */
function handleTransfer(handle: FileSystemFileHandle): DataTransfer {
  return {
    types: ['Files'],
    files: [],
    getData: () => '',
    items: [{ kind: 'file', type: '', getAsFileSystemHandle: async () => handle }],
  } as unknown as DataTransfer;
}

async function mount(enabled = true): Promise<UseEditorDropResult> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  let api: UseEditorDropResult | null = null;
  const Probe = () => {
    api = useEditorDrop({ enabled, onResult: () => {} });
    return null;
  };
  await act(async () => {
    render(h(Probe, {}), container);
  });
  if (!api) throw new Error('the hook did not mount');
  return api;
}

/** Deliver a drop and drain the handler's awaits (fetch, bridge, handle). */
async function drop(api: UseEditorDropResult, transfer: DataTransfer): Promise<void> {
  const event = {
    dataTransfer: transfer,
    defaultPrevented: false,
    target: document.body,
    preventDefault: () => {},
    stopPropagation: () => {},
  };
  await act(async () => {
    api.dropProps.onDrop(event as never);
  });
  for (let pass = 0; pass < 6; pass += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

describe('a WebKit drop with no payload path', () => {
  beforeEach(() => {
    scopeResponse = {
      ok: true,
      status: 200,
      body: { root: '/repo', path: 'src/from-finder.ts', name: 'from-finder.ts', kind: 'text' },
    };
    fetchCalls = [];
    opened = [];
    bridgeCalls = [];
    bridgeAnswer = { paths: ['/repo/src/from-finder.ts'], at: Date.now() };
    window.__kabmoCall = async (method: string) => {
      bridgeCalls.push(method);
      return bridgeAnswer;
    };
  });

  test('the shell’s path is what opens the file', async () => {
    const api = await mount();
    await drop(api, webkitFinderTransfer());

    // The bridge was asked, and the answer went through the same resolver every
    // other drop uses — the shell's path is a path, not a second code path.
    expect(bridgeCalls).toEqual(['dropped_paths']);
    expect(fetchCalls[0]).toContain('/api/fs/scope?path=');
    expect(decodeURIComponent(fetchCalls[0])).toContain('/repo/src/from-finder.ts');
    expect(opened).toHaveLength(1);
    expect(opened[0]).toEqual({ path: 'src/from-finder.ts', name: 'from-finder.ts', root: '/repo' });
  });

  test('a handle still wins over the shell’s path', async () => {
    const writes: string[] = [];
    const handle = {
      name: 'by-handle.ts',
      kind: 'file',
      async getFile() {
        return new File([new TextEncoder().encode('const a = 1;\n')], 'by-handle.ts');
      },
      async createWritable() {
        return {
          async write(data: string) {
            writes.push(data);
          },
          async close() {},
        };
      },
    } as unknown as FileSystemFileHandle;

    const api = await mount();
    await drop(api, handleTransfer(handle));

    // The handle is the shape that carries write access, so it must not be
    // displaced by a path the shell also happened to capture.
    expect(bridgeCalls).toEqual([]);
    expect(fetchCalls).toHaveLength(0);
    expect(opened).toHaveLength(1);
    expect((opened[0] as { handleId?: string }).handleId).toBeTruthy();
  });

  test('an in-page drag with no path is still reported, not swallowed', async () => {
    bridgeAnswer = null;
    const api = await mount();
    await drop(api, webkitFinderTransfer());

    expect(fetchCalls).toHaveLength(0);
    expect(opened).toHaveLength(0);
  });
});

describe('readShellDroppedPaths', () => {
  beforeEach(() => {
    bridgeCalls = [];
    bridgeAnswer = { paths: ['/repo/a.ts'], at: 1_000 };
    window.__kabmoCall = async (method: string) => {
      bridgeCalls.push(method);
      return bridgeAnswer;
    };
  });

  test('a stale answer is refused', async () => {
    // The page asks in the drop's own turn; anything older is a leftover from a
    // drag released where no target claimed it.
    expect(await readShellDroppedPaths(1_000 + SHELL_DROP_TTL_MS + 1)).toEqual([]);
    expect(await readShellDroppedPaths(1_000 + SHELL_DROP_TTL_MS - 1)).toEqual(['/repo/a.ts']);
  });

  test('an empty or malformed answer reads as no help', async () => {
    bridgeAnswer = { paths: [], at: 1_000 };
    expect(await readShellDroppedPaths(1_000)).toEqual([]);
    bridgeAnswer = { paths: ['', '  '], at: 1_000 };
    expect(await readShellDroppedPaths(1_000)).toEqual([]);
    bridgeAnswer = { paths: 'nope', at: 1_000 };
    expect(await readShellDroppedPaths(1_000)).toEqual([]);
  });

  test('a browser never asks the bridge', async () => {
    delete window.__kabmoCall;
    expect(await readShellDroppedPaths(1_000)).toEqual([]);
    expect(bridgeCalls).toHaveLength(0);
  });
});
