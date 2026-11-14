/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The "wait for session" pick lives in the composer HEADER, immediately before
 * the stretch control, on both layouts — and its panel is portalled and placed
 * from the trigger's rectangle, so it flips and scrolls instead of running off
 * the window.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';
import { AttachmentToolbar } from '@/client/components/workspace/chat-timeline/chat-input/AttachmentToolbar';

const candidates = [{ id: 'sess-a', title: 'Refactor parser', folderName: 'alpha' }];

const mounted: HTMLElement[] = [];

beforeAll(() => {
  installDomGlobals(new Window({ url: 'http://localhost' }));
});

afterEach(() => {
  for (const host of mounted.splice(0)) {
    render(null, host);
    host.remove();
  }
});

afterAll(() => {
  restoreDomGlobals();
});

async function mount(node: h.JSX.Element): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  await act(async () => {
    render(node, host);
  });
  mounted.push(host);
  return host;
}

describe('AttachmentToolbar wait pick', () => {
  test('the pick sits immediately before the stretch control', async () => {
    const host = await mount(
      h(AttachmentToolbar, {
        attachments: [],
        onFilesSelected: () => {},
        onRemove: () => {},
        onToggleExpand: () => {},
        waiting: { value: null, candidates, onChange: () => {} },
      }),
    );

    const picker = host.querySelector('[data-testid="wait-picker"]');
    const expand = host.querySelector('[aria-label="Maximize composer"]');
    expect(picker).not.toBeNull();
    expect(expand).not.toBeNull();
    // The picker comes first in document order: `compareDocumentPosition`
    // reports FOLLOWING for a node that comes after.
    expect(picker!.compareDocumentPosition(expand!) & 4).toBe(4);
  });

  test('the panel is portalled, fixed, and clamped inside the viewport', async () => {
    const host = await mount(
      h(AttachmentToolbar, {
        attachments: [],
        onFilesSelected: () => {},
        onRemove: () => {},
        onToggleExpand: () => {},
        waiting: { value: null, candidates, onChange: () => {} },
      }),
    );

    await act(async () => {
      (host.querySelector('[data-testid="wait-picker"]') as HTMLButtonElement).click();
    });

    // Portalled to `document.body`, not drawn inside the composer card: a
    // `fixed` panel placed from the trigger's rectangle is what keeps it on
    // screen when the header sits at the bottom of a desktop viewport.
    const panel = document.body.querySelector('.glass-popover') as HTMLElement | null;
    expect(panel).not.toBeNull();
    expect(panel!.className).toContain('fixed');
    expect(panel!.className).not.toContain('absolute');

    // `placeMenu` writes the clamp: the panel's bottom edge stays inside the
    // window (8px margin), and its left edge is never negative.
    const top = Number.parseFloat(panel!.style.top);
    const maxHeight = Number.parseFloat(panel!.style.maxHeight);
    const left = Number.parseFloat(panel!.style.left);
    expect(Number.isFinite(top)).toBe(true);
    expect(Number.isFinite(maxHeight)).toBe(true);
    expect(top + maxHeight).toBeLessThanOrEqual(window.innerHeight);
    expect(left).toBeGreaterThanOrEqual(0);
  });

  test('a trigger near the bottom edge flips the panel above it, still on screen', async () => {
    // The desktop composer sits at the bottom of the viewport, so the header
    // row is ~30px from the bottom edge. A CSS `top-full` panel would be drawn
    // past the window; `placeMenu` flips it above the trigger instead.
    const original = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function (this: Element) {
      const el = this as HTMLElement;
      if (el.dataset?.testid === 'wait-picker') {
        return { top: 700, bottom: 730, left: 900, right: 1000, width: 100, height: 30, x: 900, y: 700, toJSON: () => ({}) } as DOMRect;
      }
      if (el.classList?.contains('glass-popover')) {
        return { top: 0, bottom: 300, left: 0, right: 300, width: 300, height: 300, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
      }
      return original.call(this);
    };
    try {
      const host = await mount(
        h(AttachmentToolbar, {
          attachments: [],
          onFilesSelected: () => {},
          onRemove: () => {},
          onToggleExpand: () => {},
          waiting: { value: null, candidates, onChange: () => {} },
        }),
      );

      await act(async () => {
        (host.querySelector('[data-testid="wait-picker"]') as HTMLButtonElement).click();
      });

      const panel = document.body.querySelector('.glass-popover') as HTMLElement;
      const top = Number.parseFloat(panel.style.top);
      const maxHeight = Number.parseFloat(panel.style.maxHeight);
      // Above the trigger (700), not below it (730).
      expect(top).toBeLessThan(700);
      expect(top + maxHeight).toBeLessThanOrEqual(window.innerHeight);
    } finally {
      Element.prototype.getBoundingClientRect = original;
    }
  });

  test('nothing is drawn while there is no running session and no pick', async () => {
    const host = await mount(
      h(AttachmentToolbar, {
        attachments: [],
        onFilesSelected: () => {},
        onRemove: () => {},
        onToggleExpand: () => {},
        waiting: { value: null, candidates: [], onChange: () => {} },
      }),
    );

    expect(host.querySelector('[data-testid="wait-picker"]')).toBeNull();
  });
});
