/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The harness the editor-drop suite drives: a happy-dom window, a stubbed
 * `fetch`, and the `DataTransfer` shapes each kind of drag actually presents.
 *
 * Split out because the suite is at the repository's per-file ceiling and this
 * half is INFRASTRUCTURE — nothing here asserts anything. The builders are the
 * load-bearing part: each one is a shape measured from a real browser, and a
 * drop test written against a convenient fake would pass while the product
 * failed (which is exactly how the "Finder drop carries no path" bug shipped).
 */

import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { useEditorDrop, type UseEditorDropResult } from '@/client/hooks/editor/use-editor-drop';

const DOM_GLOBALS = ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'Event', 'CustomEvent', 'MouseEvent', 'KeyboardEvent', 'fetch'] as const;
const nativeGlobals: Partial<Record<(typeof DOM_GLOBALS)[number], unknown>> = {};

/** What the stubbed `fetch` answers with. */
export interface ScopeAnswer {
  ok: boolean;
  status: number;
  body: unknown;
}

let scopeResponse: ScopeAnswer = { ok: true, status: 200, body: {} };
/**
 * A scripted sequence, shifted before `scopeResponse` — the shape a drop needs
 * when the first answer is a REFUSAL that earns a retry (a file outside every
 * workspace is granted, then resolved).
 */
let scopeSequence: ScopeAnswer[] = [];
let fetchCalls: string[] = [];
let opened: unknown[] = [];

/** Install the DOM, the fetch stub and the open-file recorder. */
export function installDropHarness(): void {
  const win = new Window({ url: 'http://localhost' });
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    nativeGlobals[key] = target[key];
    target[key] = (win as unknown as Record<string, unknown>)[key];
  }
  globalThis.fetch = (async (url: string) => {
    fetchCalls.push(String(url));
    const { ok, status, body } = scopeSequence.shift() ?? scopeResponse;
    return { ok, status, json: async () => body };
  }) as unknown as typeof globalThis.fetch;
  // The open path is a window event; recording it here is what proves the file
  // was handed to the editor rather than merely resolved.
  win.addEventListener('omp:open-file', (event) => {
    opened.push((event as unknown as CustomEvent).detail);
  });
}

/** Put the process back the way it was found. */
export function restoreDropHarness(): void {
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (nativeGlobals[key] === undefined) delete target[key];
    else target[key] = nativeGlobals[key];
  }
}

/** One answer for every request. */
export function setScopeResponse(answer: ScopeAnswer): void {
  scopeResponse = answer;
}

/** A sequence, consumed one answer per request. */
export function queueScopeResponses(answers: ScopeAnswer[]): void {
  scopeSequence = answers;
}

/** Every URL the hook asked for, in order. */
export function scopeFetchCalls(): string[] {
  return fetchCalls;
}

/** Every `omp:open-file` detail the hook dispatched, in order. */
export function openedFiles(): unknown[] {
  return opened;
}

/** Forget everything between cases. */
export function resetDropHarness(): void {
  scopeResponse = { ok: true, status: 200, body: {} };
  scopeSequence = [];
  fetchCalls = [];
  opened = [];
}

/** A `DataTransfer` carrying one `text/uri-list` reference, as a browser drag does. */
export function fileTransfer(reference: string): DataTransfer {
  return {
    types: ['text/uri-list'],
    files: [],
    getData: (type: string) => (type.toLowerCase() === 'text/uri-list' ? reference : ''),
  } as unknown as DataTransfer;
}

/** A `DataTransfer` with real bytes and no path — the composer's territory. */
export function bytesTransfer(): DataTransfer {
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
export function finderTransfer(handle: FileSystemFileHandle): DataTransfer {
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
export function fakeHandle(name: string, text: string) {
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

export interface Harness {
  drop: (transfer: DataTransfer) => Promise<void>;
  dragging: () => boolean;
  results: { ok: boolean; message: string }[];
}

/** Mount the hook and hand back the gestures a case drives. */
export async function mountEditorDrop(enabled = true): Promise<Harness> {
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
