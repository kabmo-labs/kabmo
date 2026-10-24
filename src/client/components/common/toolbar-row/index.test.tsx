/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The toolbar stays ONE row, and what does not fit is one click away.
 *
 * The failure this pins is a row that becomes two: the editor panel is 320px
 * wide on a 1440px screen, and the width-mode buttons pushed ten controls past
 * it. Wrapping moved the document down by the toolbar's own height and read as
 * a second toolbar; a horizontal scroll clipped the tail invisibly. Neither is
 * visible to a state-only assertion, so the cases below are about what is
 * RENDERED and what the `⋯` menu offers.
 *
 * happy-dom lays nothing out, so `getBoundingClientRect` and `clientWidth` are
 * stubbed at the PROTOTYPE level — the rule reads exactly those two values, and
 * stubbing them before the first render is what lets the component's own layout
 * effect measure a real row instead of a row of zeros.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { Save, Search, WrapText } from 'lucide-preact';
import { ToolbarRow, type ToolbarCluster } from '@/client/components/common/toolbar-row';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';

let container: HTMLElement;
/** What the stubbed layout reports for the row, and for each cluster in order. */
let rowWidth = 0;
let clusterWidths: number[] = [];

/** Captured inside `beforeAll`: the DOM globals do not exist at module load. */
let originalRect: typeof Element.prototype.getBoundingClientRect;
let originalClientWidth: PropertyDescriptor | undefined;

/** The row is the flex container the component renders; clusters carry a marker. */
function isRow(el: HTMLElement): boolean {
  return el.className.includes('flex-nowrap');
}

function rectOf(width: number): DOMRect {
  return { width, height: 0, top: 0, left: 0, right: width, bottom: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
}

beforeAll(() => {
  installDomGlobals(new Window({ url: 'http://localhost' }));
  originalRect = Element.prototype.getBoundingClientRect;
  originalClientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
  Element.prototype.getBoundingClientRect = function (this: Element) {
    const el = this as HTMLElement;
    if (el.hasAttribute?.('data-toolbar-cluster')) {
      const siblings = [...(el.parentElement?.querySelectorAll('[data-toolbar-cluster]') ?? [])];
      return rectOf(clusterWidths[siblings.indexOf(el)] ?? 0);
    }
    if (isRow(el)) return rectOf(rowWidth);
    return originalRect.call(this);
  };
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get(this: HTMLElement) {
      if (isRow(this)) return rowWidth;
      return originalClientWidth?.get?.call(this) ?? 0;
    },
  });
});

afterEach(() => {
  if (container) {
    render(null, container);
    container.remove();
  }
  rowWidth = 0;
  clusterWidths = [];
});

afterAll(() => {
  Element.prototype.getBoundingClientRect = originalRect;
  if (originalClientWidth) Object.defineProperty(HTMLElement.prototype, 'clientWidth', originalClientWidth);
  restoreDomGlobals();
});

/** Three clusters, the first pinned — the editor toolbar in miniature. */
function clusters(onSelect: string[] = []): ToolbarCluster[] {
  const make = (id: string, label: string, icon: typeof Save, pinned?: boolean): ToolbarCluster => ({
    id,
    pinned,
    actions: [{ label, icon, onSelect: () => onSelect.push(label) }],
    children: h('button', { type: 'button', 'aria-label': label }, label),
  });
  return [
    make('save', 'Save file', Save, true),
    make('find', 'Find and replace', Search),
    make('wrap', 'Word wrap on', WrapText),
  ];
}

async function mount(width: number, widths: number[], onSelect: string[] = []): Promise<void> {
  rowWidth = width;
  clusterWidths = widths;
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    render(h(ToolbarRow, { clusters: clusters(onSelect) }), container);
  });
  // The layout effect commits its measurement in a second pass, the way the
  // browser gives one before paint.
  await act(async () => {});
}

function rowButtons(): HTMLButtonElement[] {
  const host = container.firstElementChild as HTMLElement;
  return [...host.querySelectorAll<HTMLButtonElement>(':scope > div > button')];
}

async function openMenu(): Promise<void> {
  const trigger = rowButtons().find((button) => button.getAttribute('aria-label') === 'More actions');
  if (!trigger) throw new Error('no overflow trigger rendered');
  await act(async () => {
    trigger.dispatchEvent(new window.MouseEvent('click', { bubbles: true }) as never);
  });
}

describe('ToolbarRow overflow', () => {
  test('a wide row draws every cluster and no trigger', async () => {
    await mount(400, [60, 60, 60]);
    expect(rowButtons().map((button) => button.getAttribute('aria-label'))).toEqual([
      'Save file',
      'Find and replace',
      'Word wrap on',
    ]);
  });

  test('a narrow row keeps the pinned cluster and moves the rest into `⋯`', async () => {
    await mount(120, [60, 60, 60]);
    const labels = rowButtons().map((button) => button.getAttribute('aria-label'));
    expect(labels).toContain('Save file');
    expect(labels).toContain('More actions');
    expect(labels).not.toContain('Word wrap on');
  });

  test('the menu offers the hidden controls, named in words', async () => {
    await mount(120, [60, 60, 60]);
    await openMenu();
    const items = [...container.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent?.trim());
    expect(items).toContain('Word wrap on');
    // The pinned control is on the row, so it is NOT in the menu.
    expect(items).not.toContain('Save file');
  });

  test('a menu row runs the same action the button would', async () => {
    const ran: string[] = [];
    await mount(120, [60, 60, 60], ran);
    await openMenu();
    const item = [...container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
      (row) => row.textContent?.trim() === 'Word wrap on',
    );
    if (!item) throw new Error('the wrap row is missing from the menu');
    await act(async () => {
      item.dispatchEvent(new window.MouseEvent('click', { bubbles: true }) as never);
    });
    expect(ran).toEqual(['Word wrap on']);
  });
});
