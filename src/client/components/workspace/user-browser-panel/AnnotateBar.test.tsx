/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Naming a mark in the annotation bar.
 *
 * The rule this file exists for: the panel must never present "no element" as
 * though the page had nothing there. A cross-origin frame (the normal dev-server
 * case — same host, different port) makes the DOM unreadable, and the bar says
 * exactly that, so the user knows the label is the only identity available
 * rather than assuming the tool failed silently.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';

import { AnnotateBar } from '@/client/components/workspace/user-browser-panel/AnnotateBar';
import { missingElementReason } from '@/client/components/workspace/user-browser-panel/AnnotateTarget';
import type { AnnotateShape } from '@/shared/types';

const DOM_GLOBALS = ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'Event', 'MouseEvent'] as const;
const native: Partial<Record<(typeof DOM_GLOBALS)[number], unknown>> = {};

beforeAll(() => {
  const win = new Window({ url: 'http://localhost' });
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (!(key in native)) native[key] = target[key];
    target[key] = (win as unknown as Record<string, unknown>)[key];
  }
});

afterAll(() => {
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (native[key] === undefined) delete target[key];
    else target[key] = native[key];
  }
});

function mark(overrides: Partial<AnnotateShape> = {}): AnnotateShape {
  return {
    id: 'a',
    tool: 'box',
    start: { x: 0.1, y: 0.1 },
    end: { x: 0.3, y: 0.3 },
    label: '',
    note: '',
    ...overrides,
  };
}

let container: HTMLElement | undefined;
let labels: Array<[string, string]> = [];
let notes: Array<[string, string]> = [];

interface MountOptions {
  shapes?: AnnotateShape[];
  selectedId?: string | null;
  readability?: Parameters<typeof AnnotateBar>[0]['readability'];
}

function mount({ shapes = [mark()], selectedId = 'a', readability = null }: MountOptions = {}): HTMLElement {
  labels = [];
  notes = [];
  container = document.body.appendChild(document.createElement('div'));
  act(() => {
    render(h(AnnotateBar, {
      tool: 'box',
      shapes,
      selectedId,
      readability,
      onTool: () => {},
      onLabel: (id, label) => labels.push([id, label]),
      onNote: (id, note) => notes.push([id, note]),
      onRemove: () => {},
      onReset: () => {},
      onCancel: () => {},
      onSend: () => {},
    }), container!);
  });
  return container;
}

const byText = (root: HTMLElement, text: string): HTMLButtonElement | undefined =>
  [...root.querySelectorAll('button')].find((node) => node.textContent === text);

beforeEach(() => {
  container?.remove();
  container = undefined;
});

afterEach(() => {
  if (container) render(null, container);
  container?.remove();
  container = undefined;
});

describe('label chips', () => {
  test('the offered vocabulary is rendered as chips', () => {
    const root = mount();
    for (const name of ['header', 'form', 'tabel', 'modal']) {
      expect(byText(root, name)).toBeDefined();
    }
  });

  test('picking a chip names the mark', () => {
    const root = mount();
    act(() => byText(root, 'form')!.click());
    expect(labels).toEqual([['a', 'form']]);
  });

  test('picking the chip already in force clears it, so a wrong pick is one click away', () => {
    const root = mount({ shapes: [mark({ label: 'form' })] });
    act(() => byText(root, 'form')!.click());
    expect(labels).toEqual([['a', '']]);
  });

  test('the chip matching the mark is the pressed one', () => {
    const root = mount({ shapes: [mark({ label: 'tabel' })] });
    expect(byText(root, 'tabel')?.getAttribute('aria-pressed')).toBe('true');
    expect(byText(root, 'form')?.getAttribute('aria-pressed')).toBe('false');
  });

  test('the free-text field carries the mark’s own label', () => {
    const root = mount({ shapes: [mark({ label: 'Ringkasan pesanan' })] });
    const input = root.querySelector<HTMLInputElement>('input[aria-label="Nama bagian yang ditandai"]');
    expect(input?.value).toBe('Ringkasan pesanan');
  });

  test('typing in the field names the mark directly', () => {
    const root = mount();
    const input = root.querySelector<HTMLInputElement>('input[aria-label="Nama bagian yang ditandai"]')!;
    act(() => {
      input.value = 'keranjang';
      input.dispatchEvent(new window.Event('input', { bubbles: true }));
    });
    expect(labels).toEqual([['a', 'keranjang']]);
  });

  test('the note field is separate from the label', () => {
    const root = mount();
    const note = root.querySelector<HTMLTextAreaElement>('textarea[aria-label="Catatan anotasi"]')!;
    act(() => {
      note.value = 'tombol mati';
      note.dispatchEvent(new window.Event('input', { bubbles: true }));
    });
    expect(notes).toEqual([['a', 'tombol mati']]);
    expect(labels).toEqual([]);
  });
});

describe('element readout', () => {
  test('a readable element is printed with its state', () => {
    const root = mount({
      shapes: [mark({ element: { path: 'body > form > select#prov', tag: 'select', state: 'nilai "Bali", 3 opsi' } })],
    });
    const readout = root.textContent ?? '';
    expect(readout).toContain('body > form > select#prov');
    expect(readout).toContain('nilai "Bali", 3 opsi');
  });

  test('a cross-origin page says why there is no element, in words', () => {
    const root = mount({ readability: { ok: false, reason: 'cross-origin' } });
    expect(root.textContent).toContain('beda origin');
    expect(root.textContent).toContain('nama bagian');
  });

  test('empty space is a different message from an unreadable page', () => {
    const root = mount({ readability: { ok: false, reason: 'no-element' } });
    expect(root.textContent).toContain('tidak ada elemen');
    expect(root.textContent).not.toContain('beda origin');
  });

  test('a successful lookup prints no reason line at all', () => {
    const root = mount({
      shapes: [mark({ element: { path: 'body > button', tag: 'button' } })],
      readability: { ok: true, element: { path: 'body > button', tag: 'button' } },
    });
    expect(root.textContent).not.toContain('beda origin');
    expect(root.textContent).not.toContain('tidak ada elemen');
  });
});

describe('missingElementReason', () => {
  test('no lookup yet says nothing', () => {
    expect(missingElementReason(null)).toBeNull();
  });

  test('a successful lookup says nothing', () => {
    expect(missingElementReason({ ok: true, element: { path: 'body > a', tag: 'a' } })).toBeNull();
  });

  test('a frame that is not loaded yet is its own reason', () => {
    expect(missingElementReason({ ok: false, reason: 'no-frame' })).toContain('belum dimuat');
  });
});
