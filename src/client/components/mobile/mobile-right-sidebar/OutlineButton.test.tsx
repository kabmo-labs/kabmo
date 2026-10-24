/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The phone's outline sheet.
 *
 * Same two facts the desktop section shows, on a surface that cannot share its
 * markup (the drawer has no room for a section pinned to a floor, so this is a
 * floating button and a modal). Both are pinned here because each fails
 * silently:
 *
 * - **the button names the TOTAL**, so a truncated list cannot read as "this
 *   file has 500 symbols";
 * - **a truncated list says what it is not showing**, in the sheet, where the
 *   reader is actually looking.
 *
 * Rendered with `h()` against happy-dom. `Modal` is the shared shell every
 * dialog in the app uses, so opening one here is the same code path a phone
 * takes.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { MobileOutlineButton } from '@/client/components/mobile/mobile-right-sidebar/OutlineButton';
import { MAX_OUTLINE_ROWS, outlineTruncatedNotice } from '@/shared/lib/code/outline/rows';
import type { OutlineSymbol } from '@/shared/lib/code/outline/types';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';

let container: HTMLElement;

beforeAll(() => {
  installDomGlobals(new Window({ url: 'http://localhost' }));
});

afterEach(() => {
  if (container) {
    render(null, container);
    container.remove();
  }
});

afterAll(() => {
  restoreDomGlobals();
});

function symbols(count: number): OutlineSymbol[] {
  return Array.from({ length: count }, (_, i) => ({
    name: `fn${i}`,
    kind: 'function' as const,
    line: i + 1,
    column: 0,
    depth: 0,
  }));
}

async function mount(props: {
  symbols: OutlineSymbol[];
  total?: number;
  truncated?: boolean;
  path?: string | null;
  emptyNotice?: string;
}): Promise<void> {
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    render(
      h(MobileOutlineButton, {
        path: props.path === undefined ? 'src/a.ts' : props.path,
        symbols: props.symbols,
        total: props.total ?? props.symbols.length,
        truncated: props.truncated ?? false,
        emptyNotice: props.emptyNotice ?? 'No symbols found.',
      }),
      container,
    );
  });
}

function trigger(): HTMLButtonElement {
  const el = container.querySelector('button[aria-label^="Outline"]');
  if (!el) throw new Error('no outline trigger rendered');
  return el as HTMLButtonElement;
}

async function open(): Promise<void> {
  await act(async () => {
    trigger().click();
  });
  for (let i = 0; i < 4; i += 1) await act(async () => {});
}

describe('MobileOutlineButton', () => {
  test('no path means no control — an attachment chip has nothing to outline', async () => {
    await mount({ symbols: symbols(3), path: null });

    expect(container.querySelector('button[aria-label^="Outline"]')).toBeNull();
  });

  test('the trigger names the TOTAL, not the window', async () => {
    await mount({ symbols: symbols(MAX_OUTLINE_ROWS), total: 63_618, truncated: true });

    // The accessible name is what a screen reader announces and what a spec
    // addresses; a window count here would describe the panel, not the file.
    expect(trigger().getAttribute('aria-label')).toBe('Outline (63618 symbols)');
  });

  test('a truncated sheet renders the window and says what it is not showing', async () => {
    await mount({ symbols: symbols(MAX_OUTLINE_ROWS), total: 700, truncated: true });
    await open();

    const rows = container.querySelectorAll('button[aria-label*=", line "]');
    expect(rows).toHaveLength(MAX_OUTLINE_ROWS);
    expect(container.textContent).toContain(outlineTruncatedNotice(700));
    // The header count reads window/total, so it cannot be mistaken for the
    // number of symbols the file has.
    expect(container.textContent).toContain(`${MAX_OUTLINE_ROWS}/700`);
  });

  test('a complete list shows no truncation sentence', async () => {
    await mount({ symbols: symbols(4) });
    await open();

    expect(container.querySelectorAll('button[aria-label*=", line "]')).toHaveLength(4);
    expect(container.textContent).not.toContain('Showing the first');
  });

  test('an empty list prints the reason it is empty, not a blank sheet', async () => {
    await mount({ symbols: [], emptyNotice: 'This tab has no outline.' });
    await open();

    expect(container.textContent).toContain('This tab has no outline.');
  });
});
