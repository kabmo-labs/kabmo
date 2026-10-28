/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The Files panel's listing behaviours, driven through a REAL realtime server
 * and the panel's own HTTP reads (see `file-explorer.test-util`).
 *
 * 1. **A refresh re-reads the open folders.** The root listing never carries a
 *    folder's children, so a panel that re-read only the root kept rendering
 *    the children it had cached when the folder was expanded: a file or folder
 *    deleted inside one stayed on screen — the panel's own Refresh included.
 *    Measured on a real workspace: deleting a nested folder left it listed under
 *    its open parent, and no amount of refreshing the root could remove it.
 *
 * 2. **An empty folder is LOADED, not "not loaded yet".** `children: null` means
 *    "fetch me"; `children: []` means the folder was read and is empty. Reading
 *    both as the former made every render of an open empty folder fire another
 *    request (the answer is a fresh array, so the tree always re-renders), and
 *    the row flickered between "Loading…" and nothing — measured as a continuous
 *    loop while an empty folder was expanded.
 *
 * The harness's disk is a real directory model: the tests mutate it between
 * reads, which is what makes the refresh assertion fail on the old code (the
 * cached children would answer from memory, never from the model).
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
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

describe('Files panel listing', () => {
  test('a refresh re-reads an open folder, so an entry deleted inside it disappears', async () => {
    panel.disk = { '.': { src: null }, src: { 'keep.ts': 'file', 'gone.ts': 'file' } };
    panel.dirReads = [];
    await panel.mount();
    await panel.clickRow('src');
    expect(panel.container.textContent).toContain('gone.ts');

    // Removed from disk — the panel can only know by reading the folder again.
    delete panel.disk['src']!['gone.ts'];
    await panel.clickRefresh();

    expect(panel.dirReads.filter((path) => path === 'src').length).toBeGreaterThan(1);
    expect(panel.container.textContent).not.toContain('gone.ts');
    expect(panel.container.textContent).toContain('keep.ts');
  });

  test('an expanded empty folder is read once, and expanding a sibling does not re-read it', async () => {
    panel.disk = { '.': { empty: null, keep: null }, empty: {}, keep: { 'a.ts': 'file' } };
    panel.dirReads = [];
    await panel.mount();
    const emptyReads = () => panel.dirReads.filter((path) => path === 'empty').length;

    await panel.clickRow('empty');
    expect(emptyReads()).toBe(1);
    expect(panel.container.textContent).not.toContain('a.ts');

    // Expanding a DIFFERENT folder re-renders every row, the empty one
    // included. `children: []` is the server's answer for a folder that was
    // read, so the empty row has nothing left to ask for. Measured on the
    // pre-fix code, the empty array read as "not loaded yet" and this expand
    // produced another read of `empty` (as did every later re-render — one git
    // or fs frame per tool call).
    await panel.clickRow('keep');
    expect(panel.container.textContent).toContain('a.ts');
    expect(emptyReads()).toBe(1);
    // The sibling itself is read once, not once per render of the tree.
    expect(panel.dirReads.filter((path) => path === 'keep').length).toBe(1);
  });

  test('a refresh drops an expanded folder that no longer exists, and stops asking for it', async () => {
    panel.disk = { '.': { nested: null, keep: null }, nested: { 'a.ts': 'file' }, keep: {} };
    panel.dirReads = [];
    await panel.mount();
    await panel.clickRow('nested');
    expect(panel.container.textContent).toContain('a.ts');

    // The whole folder goes. The root listing no longer names it, so the tree
    // drops the row; its CACHED children must go with it, and the expansion set
    // must forget it — otherwise every later refresh keeps asking the server
    // about a directory that is not there.
    delete panel.disk['nested'];
    delete panel.disk['.']?.nested;
    await panel.clickRefresh();

    expect(panel.container.textContent).not.toContain('a.ts');
    const afterDelete = panel.dirReads.filter((path) => path === 'nested').length;
    expect(afterDelete).toBeGreaterThan(0);

    // A second refresh must not ask again: the folder left the expansion set.
    await panel.clickRefresh();
    expect(panel.dirReads.filter((path) => path === 'nested').length).toBe(afterDelete);
  });

  test('a read that fails leaves the row alone and is not retried until it is re-expanded', async () => {
    panel.disk = { '.': { src: null }, src: { 'a.ts': 'file' } };
    panel.dirReads = [];
    await panel.mount();
    const srcReads = () => panel.dirReads.filter((path) => path === 'src').length;

    // The first expand fails at the transport: `children` stays null, which the
    // row must NOT read as "try again" — an unreadable folder would otherwise
    // re-ask on every render, forever.
    panel.failNext.add('src');
    await panel.clickRow('src');
    expect(srcReads()).toBe(1);
    expect(panel.container.textContent).not.toContain('a.ts');

    // A sibling expand re-renders the tree; the failed row must stay quiet.
    await panel.clickRow('src'); // collapse (clears the latch)
    await panel.clickRow('src');
    expect(srcReads()).toBe(2);
    expect(panel.container.textContent).toContain('a.ts');
  });

  test('a package tree is ONE row naming the whole chain, and it expands into the deepest folder', async () => {
    panel.disk = {
      '.': { com: null },
      com: { java: null },
      'com/java': { app: null },
      'com/java/app': { package: null },
      'com/java/app/package': { 'Main.java': 'file' },
    };
    panel.dirReads = [];
    await panel.mount();

    // One row instead of four: the chain's own levels are not rows at all.
    expect(panel.visibleNames()).toContain('com/java/app/package');
    expect(panel.visibleNames()).not.toContain('com');
    // Reading the row's own path is the read that would have happened on the
    // fourth expand; the three levels above it are never asked about.
    expect(panel.dirReads).toEqual(['.']);

    await panel.clickRow('com/java/app/package');

    expect(panel.container.textContent).toContain('Main.java');
    expect(panel.dirReads).toContain('com/java/app/package');
    expect(panel.dirReads).not.toContain('com');
    expect(panel.dirReads).not.toContain('com/java');
  });

  test('a folder holding a folder and a file is not collapsed', async () => {
    panel.disk = {
      '.': { src: null },
      src: { deep: null, 'a.ts': 'file' },
      'src/deep': { 'b.ts': 'file' },
    };
    await panel.mount();

    expect(panel.visibleNames()).toContain('src');
    expect(panel.visibleNames()).not.toContain('src/deep');
  });

  test('the delete dialog names the path it deletes, not just the chain label', async () => {
    // A chain INSIDE a folder is labelled relative to that folder
    // (`java/app/package`) while its path names the whole thing. Both are on
    // screen, because the delete removes the deepest directory only — a dialog
    // showing just the label would promise more than it performs.
    panel.disk = {
      '.': { com: null },
      com: { java: null, 'README.md': 'file' },
      'com/java': { app: null },
      'com/java/app': { package: null },
      'com/java/app/package': { 'Main.java': 'file' },
    };
    await panel.mount();
    await panel.clickRow('com');

    await panel.rightClickRow('java/app/package');
    await panel.clickMenuRow('Delete');

    const text = panel.documentText();
    expect(text).toContain('com/java/app/package');
    expect(text).toContain('this deletes');
  });
});
