/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The editor drop target's OVERLAY state.
 *
 * Every case here was a way the overlay could stay lit with the pointer nowhere
 * near the panel, which is what a user reports as "the drop target is stuck":
 *
 * - `dragenter` fires for every nested child the pointer crosses, so the counter
 *   this replaced rose with each crossing while a `dragleave` to a node still
 *   inside was ignored. Measured in Chromium against the real app: five child
 *   crossings inside the chat left the counter at 5 after one exit, and the
 *   "Drop a file to open it" overlay stayed drawn.
 * - A drag cancelled with Escape (or released outside the window) delivers NO
 *   `dragleave` and NO `dragend` for an OS file drag — measured — so only the
 *   pointer can report that the gesture is over.
 *
 * Split from `use-editor-drop.test.ts` for the per-file ceiling.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { useEditorDrop, type UseEditorDropResult } from '@/client/hooks/editor/use-editor-drop';

const DOM_GLOBALS = ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'Event', 'CustomEvent', 'fetch'] as const;
const nativeGlobals: Partial<Record<(typeof DOM_GLOBALS)[number], unknown>> = {};

beforeAll(() => {
  const win = new Window({ url: 'http://localhost' });
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    nativeGlobals[key] = target[key];
    target[key] = (win as unknown as Record<string, unknown>)[key];
  }
  globalThis.fetch = (async () => ({ ok: true, status: 200, json: async () => ({}) })) as unknown as typeof globalThis.fetch;
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

interface Harness {
  api: () => UseEditorDropResult;
  /** A node INSIDE the bound target, for the between-children case. */
  child: Node;
}

let container: HTMLElement;

async function mount(enabled = true): Promise<Harness> {
  container = document.body.appendChild(document.createElement('div'));
  const target = container.appendChild(document.createElement('div'));
  const child = target.appendChild(document.createElement('div'));

  let api: UseEditorDropResult | null = null;
  const Probe = () => {
    api = useEditorDrop({ enabled, onResult: () => {} });
    return null;
  };
  await act(async () => {
    render(h(Probe, {}), container);
  });
  return { api: () => api!, child };
}

/** A drag event as the DOM delivers it: `currentTarget` is the bound element. */
function dragEvent(transfer: DataTransfer, related: Node | null) {
  const event = new window.Event('dragover', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: transfer });
  Object.defineProperty(event, 'currentTarget', { value: container.firstElementChild });
  Object.defineProperty(event, 'relatedTarget', { value: related });
  return event as never;
}

beforeEach(() => {
  container?.remove();
});

describe('useEditorDrop overlay', () => {
  test('child crossings keep it lit and one real exit clears it', async () => {
    const harness = await mount();
    const transfer = fileTransfer('file:///repo/src/app.ts');

    await act(async () => { harness.api().dropProps.onDragEnter(dragEvent(transfer, null)); });
    expect(harness.api().isDragging).toBe(true);

    // A sweep across nested children: the pointer never leaves the panel, so
    // every leave names a node still inside it.
    for (let pass = 0; pass < 5; pass += 1) {
      await act(async () => { harness.api().dropProps.onDragOver(dragEvent(transfer, null)); });
      await act(async () => { harness.api().dropProps.onDragLeave(dragEvent(transfer, harness.child)); });
    }
    expect(harness.api().isDragging).toBe(true);

    await act(async () => { harness.api().dropProps.onDragLeave(dragEvent(transfer, null)); });
    expect(harness.api().isDragging).toBe(false);
  });

  test('a drag cancelled with no leave at all is cleared by a pointer move', async () => {
    const harness = await mount();
    await act(async () => { harness.api().dropProps.onDragEnter(dragEvent(fileTransfer('file:///repo/a.ts'), null)); });
    expect(harness.api().isDragging).toBe(true);

    // A held button is a gesture still in progress, so the overlay stays.
    const move = (buttons: number) => {
      const event = new window.PointerEvent('pointermove', { bubbles: true });
      Object.defineProperty(event, 'buttons', { value: buttons });
      window.dispatchEvent(event);
    };
    await act(async () => { move(1); });
    expect(harness.api().isDragging).toBe(true);

    await act(async () => { move(0); });
    expect(harness.api().isDragging).toBe(false);
  });

  test('a target with no workspace behind it never lights up', async () => {
    // A drop there can only be refused, and an overlay that promises an open it
    // will not perform is worse than one that stays dark.
    const harness = await mount(false);
    const transfer = fileTransfer('file:///repo/src/app.ts');
    await act(async () => { harness.api().dropProps.onDragEnter(dragEvent(transfer, null)); });
    await act(async () => { harness.api().dropProps.onDragOver(dragEvent(transfer, null)); });
    expect(harness.api().isDragging).toBe(false);
  });

  test('a drop clears it, so the overlay does not outlive the gesture', async () => {
    const harness = await mount();
    const transfer = fileTransfer('file:///repo/src/app.ts');
    await act(async () => { harness.api().dropProps.onDragEnter(dragEvent(transfer, null)); });
    expect(harness.api().isDragging).toBe(true);

    await act(async () => {
      harness.api().dropProps.onDrop(dragEvent(transfer, null));
    });
    for (let pass = 0; pass < 4; pass += 1) {
      await act(async () => { await Promise.resolve(); });
    }
    expect(harness.api().isDragging).toBe(false);
  });
});
