/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The batch delete dialog's progress bar.
 *
 * A 615-row selection is two requests and can take seconds; the dialog used to
 * say only "Deleting…", so a long run was indistinguishable from a hung one.
 * The bar is driven by the chunks that have SETTLED, and the assertion is on
 * what a screen reader and a reader both get: the count, the percentage, and
 * the accessible value.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';

import { BatchDeleteModal } from '@/client/components/common/batch-selection/BatchDeleteModal';

const DOM_GLOBALS = [
  'window',
  'document',
  'navigator',
  'Node',
  'Element',
  'HTMLElement',
  'Event',
  'MouseEvent',
  'KeyboardEvent',
] as const;
const nativeGlobals: Partial<Record<(typeof DOM_GLOBALS)[number], unknown>> = {};
let container: HTMLElement;

beforeAll(() => {
  const win = new Window({ url: 'http://localhost' });
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    nativeGlobals[key] = target[key];
    target[key] = (win as unknown as Record<string, unknown>)[key];
  }
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterAll(() => {
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (nativeGlobals[key] === undefined) delete target[key];
    else target[key] = nativeGlobals[key];
  }
});

afterEach(() => {
  render(null, container);
});

function mount(props: Partial<Parameters<typeof BatchDeleteModal>[0]> = {}): void {
  render(
    h(BatchDeleteModal, {
      mode: 'session',
      count: 615,
      isDeleting: true,
      progress: { done: 500, total: 615 },
      outcome: null,
      onClose: () => {},
      onConfirm: () => {},
      ...props,
    }),
    container,
  );
}

describe('batch delete progress', () => {
  test('a running batch names the settled count and fills the bar', () => {
    mount();
    const bar = container.querySelector('[role="progressbar"]');
    expect(bar).not.toBeNull();
    // 500 of 615 is 81%.
    expect(bar!.getAttribute('aria-valuenow')).toBe('81');
    expect(bar!.getAttribute('aria-label')).toBe('Deleting 615 sessions');
    expect(container.textContent).toContain('Deleting 500 of 615');
    expect(container.textContent).toContain('81%');
  });

  test('the bar starts empty before the first chunk settles', () => {
    mount({ progress: { done: 0, total: 615 } });
    expect(container.querySelector('[role="progressbar"]')!.getAttribute('aria-valuenow')).toBe('0');
    expect(container.textContent).toContain('Deleting 0 of 615');
  });

  test('an idle dialog draws no bar', () => {
    mount({ isDeleting: false, progress: null });
    expect(container.querySelector('[role="progressbar"]')).toBeNull();
  });
});
