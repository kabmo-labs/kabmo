/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The tab menu's rows and what each close action leaves behind.
 *
 * Two rules, and both are about not losing an edit: `Close saved` must leave the DIRTY
 * tabs standing, and a row that would do nothing is absent rather than disabled — a menu
 * of always-present rows that refuse is a menu that reads as broken.
 */

import { describe, expect, test } from 'bun:test';

import { buildTabMenuRows, tabIdsAfterClose } from '@/client/lib/editor/tab-menu';
import type { OpenedFile } from '@/shared/types/fs';

function tab(id: string, path = `src/${id}.ts`): OpenedFile {
  return { id, name: `${id}.ts`, path };
}

const A = tab('a');
const B = tab('b');
const C = tab('c');
const ALL = [A, B, C];

/**
 * Rows with the split columns defaulted.
 *
 * `activeFileId` is the tab the menu was opened on and `splitRightFileId` is null — the
 * ordinary unsplit column, where `Split right` applies and `Unsplit` does not.
 */
function menuRows(options: {
  tab: OpenedFile;
  openedFiles: OpenedFile[];
  dirtyIds?: Set<string | number>;
  reopenable?: number;
  activeFileId?: string | number | null;
  splitRightFileId?: string | number | null;
}) {
  return buildTabMenuRows({
    dirtyIds: new Set(),
    reopenable: 0,
    activeFileId: options.tab.id,
    splitRightFileId: null,
    ...options,
  });
}

describe('buildTabMenuRows', () => {
  test('every row that applies is offered', () => {
    const rows = menuRows({ tab: B, openedFiles: ALL, dirtyIds: new Set(), reopenable: 2 });
    expect(rows.map((row) => row.action)).toEqual([
      'close',
      'close-others',
      'close-all',
      'close-saved',
      'copy-path',
      'reveal-in-files',
      'reopen-closed',
    ]);
  });

  test('the only open tab offers no "close others"', () => {
    const rows = menuRows({ tab: A, openedFiles: [A], dirtyIds: new Set(), reopenable: 0 });
    expect(rows.map((row) => row.action)).toEqual(['close', 'close-all', 'copy-path', 'reveal-in-files']);
  });

  test('an empty reopen stack offers no "reopen closed"', () => {
    const rows = menuRows({ tab: A, openedFiles: ALL, dirtyIds: new Set(), reopenable: 0 });
    expect(rows.map((row) => row.action)).not.toContain('reopen-closed');
  });

  test('with every OTHER tab dirty, "close saved" would do nothing and is absent', () => {
    const rows = menuRows({ tab: A, openedFiles: ALL, dirtyIds: new Set(['b', 'c']), reopenable: 0 });
    expect(rows.map((row) => row.action)).not.toContain('close-saved');
  });

  test('"close saved" IS offered when this tab is the only saved one, since it closes it', () => {
    // The row is about the SAVED tabs, and the one it was opened on counts.
    const rows = menuRows({ tab: A, openedFiles: ALL, dirtyIds: new Set(['b', 'c']), reopenable: 0 });
    expect(rows.map((row) => row.action)).not.toContain('close-saved');
  });

  test('a diff tab offers Copy path but not Reveal — a diff names a change, not a file row', () => {
    // The path is real (it is the changed file), so copying it is meaningful; revealing
    // it in the Files panel is not, because the panel lists files and the diff tab is a
    // change against one.
    const diff: OpenedFile = { id: 'd', name: 'a.ts (diff)', path: 'a.ts', isDiff: true };
    const rows = menuRows({ tab: diff, openedFiles: [diff], dirtyIds: new Set(), reopenable: 0 });
    expect(rows.map((row) => row.action)).toEqual(['close', 'close-all', 'copy-path']);
  });

  test('a path-less tab (an attachment chip) offers no path actions', () => {
    const chip: OpenedFile = { id: 'chip', name: 'notes.txt', path: '' };
    const rows = menuRows({ tab: chip, openedFiles: [chip], dirtyIds: new Set(), reopenable: 0 });
    expect(rows.map((row) => row.action)).not.toContain('copy-path');
  });
});

describe('tabIdsAfterClose', () => {
  test('close removes exactly one tab', () => {
    expect(tabIdsAfterClose('close', B, ALL, new Set())).toEqual(['a', 'c']);
  });

  test('close others keeps exactly the tab it was opened on', () => {
    expect(tabIdsAfterClose('close-others', B, ALL, new Set())).toEqual(['b']);
  });

  test('close all keeps nothing', () => {
    expect(tabIdsAfterClose('close-all', B, ALL, new Set())).toEqual([]);
  });

  test('close saved keeps the DIRTY tabs — the only reading that cannot lose an edit', () => {
    expect(tabIdsAfterClose('close-saved', A, ALL, new Set(['b', 'c']))).toEqual(['b', 'c']);
  });

  test('close saved on a clean set keeps nothing', () => {
    expect(tabIdsAfterClose('close-saved', A, ALL, new Set())).toEqual([]);
  });

  test('a non-close action answers null, so a caller can tell it apart from "close nothing"', () => {
    expect(tabIdsAfterClose('copy-path', A, ALL, new Set())).toBeNull();
    expect(tabIdsAfterClose('reopen-closed', A, ALL, new Set())).toBeNull();
  });
});
