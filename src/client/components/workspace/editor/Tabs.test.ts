/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The editor tab strip's "file is gone" decoration.
 *
 * A deleted file keeps its tab — its buffer is still on screen, and closing it
 * silently would throw away the only copy of whatever the user had typed — so
 * the tab has to SAY the file is gone. Two conventions carry that here: the
 * name goes `text-error`, and it is struck through. Both are asserted, on the
 * visible tab AND on the hidden-tab dropdown row, because the same file can be
 * reached from either.
 *
 * Rendered with `h()` against happy-dom; the component is imported after those
 * globals exist.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import type { h as PreactH, render as PreactRender } from 'preact';
import type { act as PreactAct } from 'preact/test-utils';
import type { EditorTabs as EditorTabsComponent } from '@/client/components/workspace/editor/Tabs';
import type { OpenedFile } from '@/shared/types/fs';

let EditorTabs: typeof EditorTabsComponent;
let h: typeof PreactH;
let render: typeof PreactRender;
let act: typeof PreactAct;

let container: HTMLElement;
const installed: Record<string, unknown> = {};
const displaced: Record<string, unknown> = {};

const FILES: OpenedFile[] = [
  { id: 1, name: 'keep.ts', path: 'src/keep.ts' },
  { id: 2, name: 'gone.ts', path: 'src/gone.ts' },
];

async function mount(missingIds: Set<number | string>) {
  await act(async () => {
    render(
      h(EditorTabs, {
        openedFiles: FILES,
        activeFileId: 1,
        onSelectFile: () => {},
        onCloseFile: () => {},
        missingIds,
      }),
      container,
    );
  });
  await act(async () => {});
}

/** The element whose own text is exactly `name` (never a wrapper that contains it). */
function nameNode(name: string): HTMLElement | null {
  const matches = [...container.querySelectorAll('span')].filter((el) => el.textContent?.trim() === name);
  return (matches[matches.length - 1] as HTMLElement | undefined) ?? null;
}

beforeAll(async () => {
  const win = new Window({ url: 'http://localhost' });
  for (const key of ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'ResizeObserver'] as const) {
    displaced[key] = (globalThis as Record<string, unknown>)[key];
    installed[key] = (win as unknown as Record<string, unknown>)[key];
    (globalThis as Record<string, unknown>)[key] = installed[key];
  }
  ({ EditorTabs } = await import('@/client/components/workspace/editor/Tabs'));
  ({ h, render } = await import('preact'));
  ({ act } = await import('preact/test-utils'));
});

afterAll(() => {
  for (const key of Object.keys(installed)) {
    if (displaced[key] === undefined) delete (globalThis as Record<string, unknown>)[key];
    else (globalThis as Record<string, unknown>)[key] = displaced[key];
  }
});

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  if (container) render(null, container);
  container?.remove();
});

describe('EditorTabs missing-file decoration', () => {
  test('a deleted file’s tab is red and struck through', async () => {
    await mount(new Set([2]));

    const gone = nameNode('gone.ts');
    expect(gone).not.toBeNull();
    expect(gone!.className).toContain('text-error');
    expect(gone!.className).toContain('line-through');
  });

  test('a file that is still there keeps its normal tab', async () => {
    await mount(new Set([2]));

    const keep = nameNode('keep.ts');
    expect(keep).not.toBeNull();
    expect(keep!.className).not.toContain('text-error');
    expect(keep!.className).not.toContain('line-through');
  });

  test('the tab’s tooltip names the reason', async () => {
    await mount(new Set([2]));

    const gone = nameNode('gone.ts');
    const tab = gone!.closest('[title]');
    expect(tab?.getAttribute('title')).toContain('no longer exists');
  });

  test('with nothing missing, no tab is decorated', async () => {
    await mount(new Set());

    for (const name of ['keep.ts', 'gone.ts']) {
      const node = nameNode(name);
      expect(node!.className).not.toContain('text-error');
      expect(node!.className).not.toContain('line-through');
    }
  });
});
