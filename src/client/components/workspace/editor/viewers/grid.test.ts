/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The spreadsheet grid's interaction contract, mounted against happy-dom.
 *
 * The pure halves (the selection arithmetic, the TSV payload) are pinned in
 * `shared/lib/fs/grid-selection.test.ts`. What is left is the wiring, and each
 * claim here is one that fails silently in a browser:
 *
 * - a workbook's sheet tabs switch the grid, and a legacy `.xls` opens at all;
 * - a click selects a cell, a drag selects the block between the anchor and the
 *   pointer, and an arrow key moves the active cell;
 * - the copy button writes the selected block as the TSV Excel pastes as cells.
 *
 * Rendered with `h()` (no JSX) against happy-dom, following `viewers.test.ts`.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import * as XLSX from 'xlsx';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';
import type { ByteSource } from '@/client/components/workspace/editor/viewers/bytes';
import type { CsvGrid as CsvGridType } from '@/client/components/workspace/editor/viewers/CsvGrid';
import type { SheetView as SheetViewType } from '@/client/components/workspace/editor/viewers/SheetView';

let CsvGrid: typeof CsvGridType;
let SheetView: typeof SheetViewType;
let container: HTMLElement;

beforeAll(async () => {
  const win = new Window({ url: 'http://localhost' });
  installDomGlobals(win);
  ({ CsvGrid } = await import('@/client/components/workspace/editor/viewers/CsvGrid'));
  ({ SheetView } = await import('@/client/components/workspace/editor/viewers/SheetView'));
});

afterAll(() => restoreDomGlobals());

afterEach(() => {
  if (container) render(null, container);
  container?.remove();
});

/** Mount a node and settle the async load. */
async function mount(node: unknown) {
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    render(node as never, container);
  });
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
  await act(async () => {
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
  });
  return container;
}

/**
 * Dispatch a pointer event and let Preact commit the state it caused.
 *
 * The constructor comes off the happy-dom WINDOW: `PointerEvent` is not one of
 * the globals `installDomGlobals` installs, so the bare name is a
 * ReferenceError under `bun test`.
 */
async function pointer(target: Element, type: string, init: PointerEventInit = {}) {
  await act(async () => {
    target.dispatchEvent(new window.PointerEvent(type, { bubbles: true, button: 0, ...init }));
  });
}

/** A two-sheet workbook in the requested container format. */
function workbookBytes(bookType: 'xlsx' | 'xls'): ArrayBuffer {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['Name', 'Qty'], ['Widget', 3]]), 'First');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['Code'], ['X-1']]), 'Second');
  return XLSX.write(workbook, { type: 'array', bookType }) as ArrayBuffer;
}

function workbookSource(bytes: ArrayBuffer): ByteSource {
  return {
    id: 'workbook',
    url: null,
    loadBytes: async () => bytes,
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  };
}

describe('SheetView sheets', () => {
  test('every sheet is a tab, and clicking one switches the grid', async () => {
    await mount(h(SheetView, { source: workbookSource(workbookBytes('xlsx')), name: 'book.xlsx', revision: 0 }));
    const tabs = Array.from(container.querySelectorAll('[role="tab"]'));
    expect(tabs.map((tab) => tab.textContent)).toEqual(['First', 'Second']);
    expect(container.textContent).toContain('Widget');

    await act(async () => {
      (tabs[1] as HTMLElement).dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });
    expect(container.textContent).toContain('X-1');
    expect(container.textContent).not.toContain('Widget');
  });

  // The legacy OLE2 container is the format the old reader refused outright;
  // this is the claim that `.xls` now opens in the same viewer.
  test('a legacy .xls workbook is read', async () => {
    await mount(h(SheetView, { source: workbookSource(workbookBytes('xls')), name: 'legacy.xls', revision: 0 }));
    expect(container.textContent).toContain('Widget');
    expect(container.querySelectorAll('[role="tab"]').length).toBe(2);
  });
});

describe('DataGrid selection', () => {
  const csv = 'Name,Qty\nWidget,3\nGadget,1';

  test('a click selects one cell and marks it active', async () => {
    await mount(h(CsvGrid, { content: csv, path: 'data.csv' }));
    const cell = container.querySelector('[data-row="0"][data-col="0"]') as HTMLElement;
    await pointer(cell, 'pointerdown');
    expect(cell.className).toContain('ring-info');
    expect(container.textContent).toContain('A1 · 1×1');
  });

  test('a drag selects the block between the anchor and the pointer', async () => {
    await mount(h(CsvGrid, { content: csv, path: 'data.csv' }));
    const start = container.querySelector('[data-row="0"][data-col="0"]') as HTMLElement;
    const end = container.querySelector('[data-row="1"][data-col="1"]') as HTMLElement;
    await pointer(start, 'pointerdown');
    await pointer(end, 'pointerover');
    await act(async () => {
      window.dispatchEvent(new window.PointerEvent('pointerup', { bubbles: true }));
    });
    expect(container.textContent).toContain('A1:B2 · 2×2');
    expect(end.className).toContain('bg-info/10');
  });

  test('the copy button writes the selected block as TSV', async () => {
    const written: string[] = [];
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async (text: string) => void written.push(text) },
    });
    // happy-dom leaves `isSecureContext` undefined, and the clipboard helper
    // refuses the async API without it — the fallback is `execCommand`, which
    // happy-dom does not implement.
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
    await mount(h(CsvGrid, { content: csv, path: 'data.csv' }));
    const start = container.querySelector('[data-row="0"][data-col="0"]') as HTMLElement;
    const end = container.querySelector('[data-row="1"][data-col="1"]') as HTMLElement;
    await pointer(start, 'pointerdown');
    await pointer(end, 'pointerover');
    const button = Array.from(container.querySelectorAll('button')).find((node) => node.textContent?.includes('Copy'));
    await act(async () => {
      (button as HTMLElement).dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      // The copy is async: the confirmation is a state update after the
      // clipboard promise settles.
      for (let i = 0; i < 5; i += 1) await Promise.resolve();
    });
    // The CSV's first row is the header strip, so the data block starts at
    // Widget — the same rows the grid numbers 1 and 2.
    expect(written).toEqual(['Widget\t3\r\nGadget\t1']);
    expect(container.textContent).toContain('Copied');
  });

  // The grid has no writer, so a paste must say so rather than do nothing.
  test('a paste is refused in words', async () => {
    await mount(h(CsvGrid, { content: csv, path: 'data.csv' }));
    const grid = container.querySelector('[role="grid"]') as HTMLElement;
    await act(async () => {
      grid.dispatchEvent(new window.Event('paste', { bubbles: true }));
    });
    expect(container.textContent).toContain('This grid is read-only');
  });

  test('an arrow key moves the active cell', async () => {
    await mount(h(CsvGrid, { content: csv, path: 'data.csv' }));
    const grid = container.querySelector('[role="grid"]') as HTMLElement;
    const first = container.querySelector('[data-row="0"][data-col="0"]') as HTMLElement;
    await pointer(first, 'pointerdown');
    await act(async () => {
      grid.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    });
    const next = container.querySelector('[data-row="0"][data-col="1"]') as HTMLElement;
    expect(next.className).toContain('ring-info');
    expect(container.textContent).toContain('B1 · 1×1');
  });
});

/** Open a cell's inline editor with a double-click. */
async function openEditor(cell: Element) {
  await act(async () => {
    cell.dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true }));
  });
  return container.querySelector('[data-edit-input]') as HTMLInputElement | null;
}

/** Type into the open editor and press a key. */
async function typeAndPress(input: HTMLInputElement, value: string, key: string) {
  await act(async () => {
    input.value = value;
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
  await act(async () => {
    input.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true }));
  });
}

describe('DataGrid editing', () => {
  const csv = 'Name,Qty\nWidget,3\nGadget,1';

  test('a double-click opens the cell, and Enter writes the text back', async () => {
    const changes: string[] = [];
    await mount(h(CsvGrid, { content: csv, path: 'data.csv', onChange: (next) => changes.push(next) }));
    const cell = container.querySelector('[data-row="0"][data-col="1"]') as HTMLElement;
    const input = await openEditor(cell);
    expect(input).not.toBeNull();
    expect(input?.value).toBe('3');

    await typeAndPress(input as HTMLInputElement, '7', 'Enter');
    expect(changes).toEqual(['Name,Qty\nWidget,7\nGadget,1']);
    expect(container.querySelector('[data-edit-input]')).toBeNull();
  });

  test('Escape closes the editor without writing', async () => {
    const changes: string[] = [];
    await mount(h(CsvGrid, { content: csv, path: 'data.csv', onChange: (next) => changes.push(next) }));
    const cell = container.querySelector('[data-row="0"][data-col="1"]') as HTMLElement;
    const input = await openEditor(cell);
    await typeAndPress(input as HTMLInputElement, '9', 'Escape');
    expect(changes).toEqual([]);
    expect(container.querySelector('[data-edit-input]')).toBeNull();
  });

  test('a header cell is editable too', async () => {
    const changes: string[] = [];
    await mount(h(CsvGrid, { content: csv, path: 'data.csv', onChange: (next) => changes.push(next) }));
    const header = container.querySelector('[data-col-header="1"]') as HTMLElement;
    const input = await openEditor(header);
    await typeAndPress(input as HTMLInputElement, 'Count', 'Enter');
    expect(changes).toEqual(['Name,Count\nWidget,3\nGadget,1']);
  });

  // A capped parse holds only the first rows; writing that table back would
  // drop every row past the cap, so the grid refuses to edit at all.
  test('a truncated CSV is not editable', async () => {
    const lines = ['h'];
    for (let i = 0; i < 2100; i += 1) lines.push(String(i));
    const changes: string[] = [];
    await mount(h(CsvGrid, { content: lines.join('\n'), path: 'big.csv', onChange: (next) => changes.push(next) }));
    const cell = container.querySelector('[data-row="0"][data-col="0"]') as HTMLElement;
    expect(await openEditor(cell)).toBeNull();
  });
});

describe('SheetView editing', () => {
  test('an edited cell is written back into the workbook bytes', async () => {
    const saved: Uint8Array[] = [];
    const dirty: boolean[] = [];
    await mount(
      h(SheetView, {
        source: workbookSource(workbookBytes('xlsx')),
        name: 'book.xlsx',
        path: 'book.xlsx',
        revision: 0,
        onSaveBytes: async (bytes: Uint8Array) => {
          saved.push(bytes);
          return { ok: true };
        },
        onDirtyChange: (value: boolean) => dirty.push(value),
      }),
    );

    const cell = container.querySelector('[data-row="0"][data-col="1"]') as HTMLElement;
    const input = await openEditor(cell);
    await typeAndPress(input as HTMLInputElement, '7', 'Enter');
    // The mount reports "clean" first: the editor has to state the flag it
    // knows, or a flag left over from a closed tab would stay armed.
    expect(dirty).toEqual([false, true]);
    expect(container.textContent).toContain('Saving rewrites the workbook');

    const save = Array.from(container.querySelectorAll('button')).find((node) => node.textContent === 'Save');
    await act(async () => {
      (save as HTMLElement).dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      for (let i = 0; i < 5; i += 1) await Promise.resolve();
    });

    expect(saved.length).toBe(1);
    const written = XLSX.read(saved[0], { type: 'array' });
    const rows = XLSX.utils.sheet_to_json<string[]>(written.Sheets.First, { header: 1, raw: false, defval: '' });
    expect(rows[1]).toEqual(['Widget', '7']);
    expect(dirty).toEqual([false, true, false]);
  });
});
