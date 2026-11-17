/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The full-screen drawing shell both previews share.
 *
 * happy-dom has no layout engine, so `offsetWidth` is 0 and the shell never
 * measures or fits — which is exactly why these tests pin the parts that do not
 * need a measurement: the dialog, the control pill, the keyboard contract, and
 * the body-scroll lock. The fit itself is exercised in the browser.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';
import { FullscreenViewer } from '@/client/components/common/fullscreen-viewer';

let container: HTMLElement;

beforeAll(() => {
  installDomGlobals(new Window({ url: 'http://localhost' }));
});

afterAll(() => restoreDomGlobals());

afterEach(() => {
  if (container) render(null, container);
  container?.remove();
});

function mount(node: unknown) {
  container = document.createElement('div');
  document.body.appendChild(container);
  act(() => {
    render(node as never, container);
  });
  return container;
}

function viewer(onClose: () => void) {
  return h(FullscreenViewer, {
    onClose,
    ariaLabel: 'Picture under test',
    measureKey: 'src',
    children: h('img', { src: '/api/omp/blob?hash=abc', alt: 'Picture under test' }),
  });
}

const percent = () => document.querySelector('.tabular-nums')?.textContent;

describe('FullscreenViewer', () => {
  test('opens as a dialog over the page, holding the drawing and the pill', () => {
    mount(viewer(() => {}));
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.getAttribute('aria-modal')).toBe('true');
    expect(dialog?.getAttribute('aria-label')).toBe('Picture under test');
    expect(dialog?.querySelector('img')?.getAttribute('src')).toBe('/api/omp/blob?hash=abc');
    for (const label of ['Zoom out (-)', 'Zoom in (+)', 'Fit to view (0)', 'Close (Esc)']) {
      expect(dialog?.querySelector(`button[title="${label}"]`)).not.toBeNull();
    }
    // Portalled to `<body>`, not nested in the card that opened it: a `fixed`
    // overlay inside the composer card is sized to the card.
    expect(container.contains(dialog)).toBe(false);
  });

  test('the pill zooms, and the readout is the current scale', () => {
    const root = mount(viewer(() => {}));
    expect(percent()).toBe('100%');
    act(() => (root.ownerDocument.querySelector('button[title="Zoom in (+)"]') as HTMLButtonElement).click());
    expect(percent()).toBe('140%');
    act(() => (root.ownerDocument.querySelector('button[title="Zoom out (-)"]') as HTMLButtonElement).click());
    expect(percent()).toBe('100%');
  });

  test('keyboard: +/- zoom and Esc closes', () => {
    let closed = 0;
    const root = mount(viewer(() => closed++));
    const dialog = root.ownerDocument.querySelector('[role="dialog"]') as HTMLElement;

    act(() => {
      window.dispatchEvent(new window.KeyboardEvent('keydown', { key: '+' }));
    });
    expect(percent()).toBe('140%');

    act(() => {
      window.dispatchEvent(new window.KeyboardEvent('keydown', { key: '-' }));
    });
    expect(percent()).toBe('100%');

    expect(closed).toBe(0);
    act(() => {
      dialog.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(closed).toBe(1);
  });

  test('pins the page scroll while it is open and restores it on close', () => {
    const root = mount(viewer(() => {}));
    expect(root.ownerDocument.body.style.overflow).toBe('hidden');
    act(() => render(null, root));
    expect(root.ownerDocument.body.style.overflow).toBe('');
  });
});
