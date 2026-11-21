/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The phone editor's title bar draws CONTROLS, not glyphs squeezed into a row.
 *
 * It used to pack nine actions into 390px at `p-1.5` each: measured in Chromium
 * at a 390x844 viewport, every control was **27x27** — 9px under the 36px
 * phone-chrome plate the rest of the app uses and 17px under the 44px touch
 * floor — and five of the nine carried a `title` with no accessible name.
 *
 * These cases pin the structure that replaced it: the plate size, the names, and
 * the fold (word wrap and zoom always; copy and download only while the row can
 * hold them). The pixel sizes are the stylesheet's, so a DOM test pins the
 * CONTRACT — the same note `TabStrip.test.tsx` records.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { EditorHeader } from '@/client/components/mobile/mobile-right-sidebar/Header';
import { CONTROL_BOX } from '@/client/lib/ui/control-plate';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';

let container: HTMLElement;

beforeAll(() => {
  installDomGlobals(new Window({ url: 'http://localhost' }));
});

afterEach(() => {
  if (container) render(null, container);
  container?.remove();
});

afterAll(() => {
  restoreDomGlobals();
});

/**
 * Mount at a chosen viewport width.
 *
 * The fold is a WIDTH decision, so a case that does not say where it is mounted
 * is asserting a layout nobody chose. happy-dom resolves `matchMedia` against
 * `innerWidth`, which is the same signal a real resize raises — the pattern
 * `header-controls/index.test.tsx` established.
 */
function mount(
  overrides: Partial<Parameters<typeof EditorHeader>[0]> = {},
  width = 390,
): HTMLElement {
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true, writable: true });
  container = document.createElement('div');
  document.body.append(container);
  act(() =>
    render(
      h(EditorHeader, {
        fileName: 'AGENTS.md',
        hasPreview: true,
        isPreview: true,
        hasReview: true,
        isReviewing: false,
        onToggleReview: () => {},
        wordWrap: true,
        copied: false,
        onClose: () => {},
        onTogglePreview: () => {},
        onToggleFind: () => {},
        findOpen: false,
        onToggleWrap: () => {},
        onZoomOut: () => {},
        onZoomIn: () => {},
        onCopy: () => {},
        onDownload: () => {},
        ...overrides,
      }),
      container,
    ),
  );
  return container;
}

const labels = (root: HTMLElement) =>
  [...root.querySelectorAll('button')].map((button) => button.getAttribute('aria-label'));

describe('the phone editor title bar', () => {
  test('every control carries an accessible name, not just a title', () => {
    const root = mount();
    for (const button of root.querySelectorAll('button')) {
      expect(button.getAttribute('aria-label')).toBeTruthy();
    }
  });

  test('every control uses the shared phone control plate', () => {
    const root = mount();
    for (const button of root.querySelectorAll('button')) {
      expect(button.className).toContain(CONTROL_BOX.mobile);
    }
  });

  test('the one-shot exports fold into the overflow menu on a narrow row', () => {
    const root = mount();
    const names = labels(root);
    // The mid-read controls stay in the row.
    expect(names).toContain('Find in file');
    expect(names).toContain('View source');
    expect(names).toContain('Review this document');
    // Copy and download are behind `⋯`, which is one standing control.
    expect(names).not.toContain('Copy content');
    expect(names).not.toContain('Download file');
    expect(names).toContain('More file actions');
  });

  test('the overflow menu names the folded actions in words', () => {
    const root = mount();
    const trigger = root.querySelector('button[aria-label="More file actions"]') as HTMLElement;
    act(() => trigger.click());
    const menu = root.querySelector('[role="menu"][aria-label="File actions"]') as HTMLElement;
    expect(menu).not.toBeNull();
    const rows = [...menu.querySelectorAll('[role="menuitem"]')].map((row) => row.textContent ?? '');
    expect(rows.some((row) => row.includes('Word wrap'))).toBe(true);
    expect(rows.some((row) => row.includes('Copy content'))).toBe(true);
    expect(rows.some((row) => row.includes('Download file'))).toBe(true);
  });

  test('a folded action runs when its row is pressed', () => {
    let copied = 0;
    const root = mount({ onCopy: () => { copied += 1; } });
    act(() => (root.querySelector('button[aria-label="More file actions"]') as HTMLElement).click());
    const row = [...root.querySelectorAll('[role="menuitem"]')].find((item) =>
      (item.textContent ?? '').includes('Copy content'),
    ) as HTMLElement;
    expect(row).toBeDefined();
    act(() => row.click());
    expect(copied).toBe(1);
  });

  test('a byte viewer folds no text-only action into the menu', () => {
    const root = mount({ byteViewer: true, hasPreview: false, hasReview: false });
    // No find, no wrap, no zoom — but the exports still need a home.
    const names = labels(root);
    expect(names).not.toContain('Find in file');
    act(() => (root.querySelector('button[aria-label="More file actions"]') as HTMLElement).click());
    const rows = [...root.querySelectorAll('[role="menuitem"]')].map((row) => row.textContent ?? '');
    expect(rows.some((row) => row.includes('Word wrap'))).toBe(false);
    expect(rows.some((row) => row.includes('Increase font size'))).toBe(false);
    expect(rows.some((row) => row.includes('Download file'))).toBe(true);
  });

  test('a missing file offers the recreate-and-save control, named', () => {
    const root = mount({ missing: true, onSave: () => {} });
    expect(labels(root)).toContain('Save and recreate the file');
  });
});
