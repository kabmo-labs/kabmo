/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The Files panel's multi-selection and the archive entries it unlocks.
 *
 * Driven through the real panel, a real realtime server and the panel's own
 * HTTP reads (see `file-explorer.test-util`). A shift-click is the only way to
 * mark a block, so the assertions read the MENU the block produces: a menu that
 * says "Cut 1" after a range is a selection that never left the clicked row.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { act } from 'preact/test-utils';
import { createFileExplorerHarness } from '@/test-support/file-explorer.test-util';

const panel = createFileExplorerHarness();

beforeAll(() => {
  panel.install();
});

afterEach(() => {
  panel.unmount();
});

afterAll(() => {
  panel.restore();
});

async function clickRowWith(name: string, init: MouseEventInit): Promise<void> {
  const row = panel.rowFor(name);
  await act(async () => {
    row.dispatchEvent(new window.MouseEvent('click', { bubbles: true, ...init }));
  });
  for (let i = 0; i < 8; i += 1) await act(async () => {});
}

describe('Files panel selection', () => {
  test('a plain click marks the opened file, and a shift-click marks the block', async () => {
    panel.disk = { '.': { 'a.ts': 'file', 'b.ts': 'file', 'c.ts': 'file', dest: null } };
    await panel.mount();

    await panel.clickRow('a.ts');
    expect(panel.openedFiles.map((file) => file.path)).toEqual(['a.ts']);

    await clickRowWith('c.ts', { shiftKey: true });
    // A range is a selection, not an open: the editor must not jump to `c.ts`.
    expect(panel.openedFiles.map((file) => file.path)).toEqual(['a.ts']);

    await panel.rightClickRow('b.ts');
    const labels = panel.buttonLabels();
    expect(labels).toContain('Cut 3 items');
    expect(labels).toContain('Copy 3 items');
    expect(labels).toContain('Compress 3 items to…');
    expect(labels).toContain('Delete 3 items');
    // A batch menu names no single row.
    expect(labels).not.toContain('Rename');
  });

  test('a meta-click toggles one row without opening it', async () => {
    panel.disk = { '.': { 'a.ts': 'file', 'b.ts': 'file' } };
    await panel.mount();

    await panel.clickRow('a.ts');
    await clickRowWith('b.ts', { metaKey: true });
    expect(panel.openedFiles.map((file) => file.path)).toEqual(['a.ts']);

    await panel.rightClickRow('a.ts');
    expect(panel.buttonLabels()).toContain('Copy 2 items');
  });

  test('Compress opens its dialog with the selection’s count', async () => {
    panel.disk = { '.': { 'a.ts': 'file', 'b.ts': 'file' } };
    await panel.mount();

    await panel.clickRow('a.ts');
    await clickRowWith('b.ts', { shiftKey: true });
    await panel.rightClickRow('a.ts');
    await panel.clickMenuRow('Compress 2 items to…');

    expect(panel.documentText()).toContain('Compress 2 items');
    expect(panel.documentText()).toContain('Format');
    const name = document.querySelector('input[aria-label="Archive name"]') as HTMLInputElement | null;
    expect(name?.value).toMatch(/\.zip$/);
  });

  test('right-clicking an archive offers Extract', async () => {
    panel.disk = { '.': { 'bundle.zip': 'file', 'a.ts': 'file' } };
    await panel.mount();

    await panel.rightClickRow('bundle.zip');
    expect(panel.buttonLabels()).toContain('Extract…');

    await panel.clickMenuRow('Extract…');
    expect(panel.documentText()).toContain('Extract bundle.zip');
    const destination = document.querySelector('input[aria-label="Extract destination"]') as HTMLInputElement | null;
    expect(destination?.value).toBe('bundle');
  });

  test('a plain file offers no Extract row', async () => {
    panel.disk = { '.': { 'a.ts': 'file' } };
    await panel.mount();
    await panel.rightClickRow('a.ts');
    expect(panel.buttonLabels()).not.toContain('Extract…');
  });
});
