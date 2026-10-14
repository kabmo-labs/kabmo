/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The editor's drop target.
 *
 * Three claims, and each is a way the gesture can go wrong invisibly:
 *
 * - A drop that RESOLVES opens the file through the same `omp:open-file` event
 *   every other surface uses, so the editor has one entry point.
 * - A drop that is REFUSED (outside every workspace, binary, oversized) reports
 *   the server's own sentence instead of opening a tab that would only render
 *   it.
 * - The gesture is CLAIMED (`stopPropagation`) so the composer's window-level
 *   drop handler cannot also see it — otherwise one drop both opens the file
 *   and queues it as a chat attachment.
 *
 * Driven through happy-dom, following `panels/Read.test.ts`: the hook reads a
 * `DataTransfer` and calls `fetch`, and both are stubs here.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { useEditorDrop, type UseEditorDropResult } from '@/client/hooks/editor/use-editor-drop';
import { writeThroughHandle } from '@/client/lib/launch/file-handlers';

const DOM_GLOBALS = ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'Event', 'CustomEvent', 'MouseEvent', 'KeyboardEvent', 'fetch'] as const;
const nativeGlobals: Partial<Record<(typeof DOM_GLOBALS)[number], unknown>> = {};

let scopeResponse: { ok: boolean; status: number; body: unknown } = { ok: true, status: 200, body: {} };
let fetchCalls: string[] = [];
let opened: unknown[] = [];

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
  // The open path is a window event; recording it here is what proves the file
  // was handed to the editor rather than merely resolved.
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

/** A `DataTransfer` carrying one `text/uri-list` reference, as a Finder drop does. */
function fileTransfer(reference: string): DataTransfer {
  return {
    types: ['text/uri-list'],
    files: [],
    getData: (type: string) => (type.toLowerCase() === 'text/uri-list' ? reference : ''),
  } as unknown as DataTransfer;
}

/** A `DataTransfer` with real bytes and no path — the composer's territory. */
function bytesTransfer(): DataTransfer {
  return {
    types: ['Files'],
    files: [{ name: 'photo.png', size: 100 }],
    getData: () => '',
  } as unknown as DataTransfer;
}

/**
 * A `DataTransfer` shaped exactly as Chrome for macOS presents a Finder drag:
 * `types: ["Files"]`, one `file` item with a handle, and NO path anywhere.
 */
function finderTransfer(handle: FileSystemFileHandle): DataTransfer {
  return {
    types: ['Files'],
    files: [],
    getData: () => '',
    items: [
      {
        kind: 'file',
        type: 'application/octet-stream',
        getAsFileSystemHandle: async () => handle,
      },
    ],
  } as unknown as DataTransfer;
}

/** A handle over `text`, recording writes so a save can be observed. */
function fakeHandle(name: string, text: string) {
  const writes: string[] = [];
  const handle = {
    name,
    kind: 'file',
    async getFile() {
      return new File([new TextEncoder().encode(text)], name);
    },
    async createWritable() {
      return {
        async write(data: string) {
          writes.push(data);
        },
        async close() {},
      };
    },
  };
  return { handle: handle as unknown as FileSystemFileHandle, writes };
}

interface Harness {
  drop: (transfer: DataTransfer) => Promise<void>;
  dragging: () => boolean;
  results: { ok: boolean; message: string }[];
}

async function mount(enabled = true): Promise<Harness> {
  const results: { ok: boolean; message: string }[] = [];
  const container = document.createElement('div');
  document.body.appendChild(container);

  let api: UseEditorDropResult | null = null;
  const Probe = () => {
    api = useEditorDrop({ enabled, onResult: (r) => results.push(r) });
    return null;
  };
  await act(async () => {
    render(h(Probe, {}), container);
  });

  return {
    drop: async (transfer) => {
      const event = new window.Event('drop', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'dataTransfer', { value: transfer });
      Object.defineProperty(event, 'stopPropagation', { value: () => {} });
      Object.defineProperty(event, 'preventDefault', { value: () => {} });
      await act(async () => {
        api?.dropProps.onDrop(event as never);
      });
      // The handler resolves the reference over `fetch` and then `res.json()`,
      // so the assertion needs that chain drained before it runs.
      for (let pass = 0; pass < 4; pass += 1) {
        await act(async () => {
          await Promise.resolve();
        });
      }
    },
    dragging: () => api?.isDragging ?? false,
    results,
  };
}

describe('useEditorDrop', () => {
  beforeEach(() => {
    scopeResponse = { ok: true, status: 200, body: {} };
    fetchCalls = [];
    opened = [];
  });

  test('a resolved reference opens the file through omp:open-file', async () => {
    scopeResponse = {
      ok: true,
      status: 200,
      body: { root: '/repo', path: 'src/app.ts', name: 'app.ts', kind: 'text' },
    };
    const harness = await mount();
    await harness.drop(fileTransfer('file:///repo/src/app.ts'));

    expect(fetchCalls[0]).toContain('/api/fs/scope?path=');
    expect(opened).toHaveLength(1);
    expect(opened[0]).toEqual({ path: 'src/app.ts', name: 'app.ts', root: '/repo' });
  });

  test('a binary file is refused with the server sentence, and opens nothing', async () => {
    scopeResponse = {
      ok: true,
      status: 200,
      body: { root: '/repo', path: 'blob.bin', name: 'blob.bin', kind: 'binary', error: 'This file is not text, so it cannot be shown in the editor.' },
    };
    const harness = await mount();
    await harness.drop(fileTransfer('file:///repo/blob.bin'));

    expect(opened).toHaveLength(0);
    expect(harness.results.at(-1)?.ok).toBe(false);
    expect(harness.results.at(-1)?.message).toContain('not text');
  });

  test('a path outside every workspace reports the refusal by name', async () => {
    scopeResponse = { ok: false, status: 403, body: { error: 'That file is outside every workspace this console can read.' } };
    const harness = await mount();
    await harness.drop(fileTransfer('file:///etc/hosts'));

    expect(opened).toHaveLength(0);
    expect(harness.results.at(-1)?.message).toContain('outside every workspace');
  });

  test('a Finder drag with a handle opens the file and can be saved', async () => {
    const { handle, writes } = fakeHandle('from-finder.ts', 'const a = 1;\n');
    const harness = await mount();
    await harness.drop(finderTransfer(handle));

    // No server round trip: a Finder drag carries no path at all.
    expect(fetchCalls).toHaveLength(0);
    expect(opened).toHaveLength(1);
    const detail = opened[0] as { path: string; content?: string; handleId?: string };
    expect(detail.path).toBe('from-finder.ts');
    expect(detail.content).toBe('const a = 1;\n');
    expect(detail.handleId).toBeTruthy();
    expect(harness.results.at(-1)?.ok).toBe(true);

    // And the handle is live, so a save writes through it rather than failing.
    expect(await writeThroughHandle(detail.handleId!, 'edited\n', { interactive: false })).toBe('written');
    expect(writes).toEqual(['edited\n']);
  });

  test('bytes with no path are reported, not silently dropped', async () => {
    const harness = await mount();
    await harness.drop(bytesTransfer());

    // No scope request is made — there is no path to resolve.
    expect(fetchCalls).toHaveLength(0);
    expect(harness.results.at(-1)?.message).toContain('composer');
  });

  test('a disabled target makes no request and opens nothing', async () => {
    const harness = await mount(false);
    await harness.drop(fileTransfer('file:///repo/src/app.ts'));

    expect(fetchCalls).toHaveLength(0);
    expect(opened).toHaveLength(0);
    expect(harness.results).toHaveLength(0);
  });
});
