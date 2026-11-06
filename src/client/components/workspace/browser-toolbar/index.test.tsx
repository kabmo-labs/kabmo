/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The browser toolbar never gives up its address bar.
 *
 * Two panels share this bar and both can be dragged down to a phone width. The
 * defect this pins is the one a fixed row produces: the trailing controls keep
 * their space and the address field — the single control the toolbar cannot do
 * without — is what gets squeezed to nothing. So the cases below assert, at
 * three bar widths, that the address field is still rendered and that whatever
 * left the row is a `⋯` row rather than a clipped button.
 *
 * happy-dom lays nothing out, so `clientWidth` and `getBoundingClientRect` are
 * stubbed at the prototype level — the component decides from exactly those.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { BrowserToolbar } from '@/client/components/workspace/browser-toolbar/index';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';

let container: HTMLElement;
/** Width the bar reports, and the width stubbed for each trailing cluster. */
let barWidth = 0;
let clusterWidths: number[] = [];

let originalRect: typeof Element.prototype.getBoundingClientRect;
let originalClientWidth: PropertyDescriptor | undefined;

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
    return originalRect.call(this);
  };
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get(this: HTMLElement) {
      if (this.hasAttribute?.('data-browser-toolbar')) return barWidth;
      return originalClientWidth?.get?.call(this) ?? 0;
    },
  });
});

afterEach(() => {
  if (container) {
    render(null, container);
    container.remove();
  }
  barWidth = 0;
  clusterWidths = [];
});

afterAll(() => {
  Element.prototype.getBoundingClientRect = originalRect;
  if (originalClientWidth) Object.defineProperty(HTMLElement.prototype, 'clientWidth', originalClientWidth);
  restoreDomGlobals();
});

/** The agent panel's bar in miniature: no viewport cluster, no annotation. */
async function mount(width: number, widths: number[], onSelect: string[] = []): Promise<void> {
  barWidth = width;
  clusterWidths = widths;
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    render(
      h(
        BrowserToolbar,
        {
          url: 'https://example.com',
          statusDotClass: 'bg-success',
          statusLabel: 'Live',
          zoomLevel: 100,
          onZoomIn: () => onSelect.push('zoom-in'),
          onZoomOut: () => {},
          onResetZoom: () => {},
          onIncludeInChat: () => onSelect.push('include'),
          onOpenExternal: () => onSelect.push('external'),
          onReconnect: () => onSelect.push('reconnect'),
          openExternalLabel: 'Buka di jendela baru',
          openExternalTitle: 'Open in new window',
          children: h('input', { 'aria-label': 'Read-only URL', value: 'https://example.com' }),
        },
      ),
      container,
    );
  });
  // The layout effects commit their measurements in a second pass.
  await act(async () => {});
}

const addressField = () => container.querySelector<HTMLElement>('[aria-label="Read-only URL"]');
const rowButtons = () =>
  [...(container.firstElementChild as HTMLElement).querySelectorAll<HTMLButtonElement>('button')];
const trigger = () => rowButtons().find((button) => button.getAttribute('aria-label') === 'More actions');

async function openMenu(): Promise<void> {
  const button = trigger();
  if (!button) throw new Error('no overflow trigger rendered');
  await act(async () => {
    button.dispatchEvent(new window.MouseEvent('click', { bubbles: true }) as never);
  });
}

function menuItems(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')];
}

describe('BrowserToolbar overflow', () => {
  test('a wide bar draws every control and no `⋯`', async () => {
    await mount(900, [60, 40, 30, 30, 30]);
    expect(addressField()).not.toBeNull();
    expect(trigger()).toBeUndefined();
    expect(rowButtons().length).toBe(7);
  });

  test('a bar too narrow for any control keeps the address field and offers them in `⋯`', async () => {
    await mount(220, [60, 40, 30, 30, 30]);
    // The point of the whole change: the address field survives at every width.
    expect(addressField()).not.toBeNull();
    expect(trigger()).not.toBeUndefined();
    await openMenu();
    const labels = menuItems().map((item) => item.textContent?.trim());
    expect(labels).toContain('Include this page in the chat draft');
    expect(labels).toContain('Copy URL');
    expect(labels).toContain('Buka di jendela baru');
  });

  test('a mid-width bar keeps the leading controls and buries only the tail', async () => {
    await mount(420, [60, 40, 30, 30, 30]);
    expect(addressField()).not.toBeNull();
    expect(trigger()).not.toBeUndefined();
    await openMenu();
    const labels = menuItems().map((item) => item.textContent?.trim());
    // Zoom and include still fit; the tail did not.
    expect(labels).not.toContain('Include this page in the chat draft');
    expect(labels).toContain('Buka di jendela baru');
  });

  test('a `⋯` row runs the action the buried button would', async () => {
    const ran: string[] = [];
    await mount(220, [60, 40, 30, 30, 30], ran);
    await openMenu();
    const item = menuItems().find((row) => row.textContent?.trim() === 'Buka di jendela baru');
    if (!item) throw new Error('the open-external row is missing from the menu');
    await act(async () => {
      item.dispatchEvent(new window.MouseEvent('click', { bubbles: true }) as never);
    });
    expect(ran).toEqual(['external']);
  });
});
