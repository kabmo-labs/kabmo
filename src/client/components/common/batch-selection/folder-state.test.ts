/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The folder-level batch rules, in isolation.
 *
 * This is the arithmetic both sidebars share, and every case below is a way the
 * two could disagree — or a way "select all" could reach something the user
 * cannot see. The pagination case is the one a browser found: a window would
 * tick rows with no checkbox on screen and no way to untick them.
 */

import { describe, expect, test } from 'bun:test';
import { folderBatchState } from '@/client/components/common/batch-selection/folder-state';
import type { BatchBinding } from '@/client/components/common/batch-selection/types';
import type { SessionItemData, WorkspaceFolderData } from '@/shared/types';

const folder = { id: 7, name: 'kabmo', isExpanded: true, sessions: [], hasMore: false, totalSessions: 0 } as WorkspaceFolderData;

function sessions(count: number, archived = 0): SessionItemData[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `s${index}`,
    folder_id: 7,
    title: `session ${index}`,
    is_archived: archived,
  }));
}

/** A binding whose selection is `selected` over `mode`. */
function binding(
  mode: 'session' | 'workspace',
  selected: string[],
  scopeFolderId: number | null = 7,
): BatchBinding {
  const all = new Set(selected);
  return {
    mode,
    scopeFolderId,
    selected,
    toggle: () => {},
    selectAllOf: () => {},
    unselectAllOf: () => {},
    summaryOf: (available) => {
      const count = available.filter((id) => all.has(id)).length;
      return {
        count,
        all: available.length > 0 && count === available.length,
        some: count > 0 && count < available.length,
      };
    },
  };
}

function state(overrides: Partial<Parameters<typeof folderBatchState>[0]> = {}) {
  return folderBatchState({
    folder,
    sessions: sessions(3),
    showArchived: false,
    visibleCount: 1,
    activeSessionId: null,
    ...overrides,
  });
}

describe('folderBatchState without a mode', () => {
  test('no checkboxes and the window applies', () => {
    const result = state();
    expect(result.folderCheckbox).toBe(false);
    expect(result.sessionCheckboxes).toBe(false);
    expect(result.folderSummary).toBeNull();
    // `visibleCount` 1 over 3 rows: the normal list paginates.
    expect(result.rendered).toHaveLength(1);
    expect(result.hiddenCount).toBe(2);
  });
});

describe('folderBatchState in session mode', () => {
  test('the scoped folder draws a header checkbox and row checkboxes', () => {
    const result = state({ batch: binding('session', []) });
    expect(result.folderCheckbox).toBe(true);
    expect(result.sessionCheckboxes).toBe(true);
    expect(result.selectableIds).toEqual(['s0', 's1', 's2']);
  });

  test('the window is lifted so every selectable row is on screen', () => {
    const result = state({ batch: binding('session', []) });
    expect(result.rendered).toHaveLength(3);
    expect(result.hiddenCount).toBe(0);
  });

  test('a workspace that did not start the selection stays ordinary', () => {
    const result = state({ batch: binding('session', [], 99) });
    expect(result.folderCheckbox).toBe(false);
    expect(result.sessionCheckboxes).toBe(false);
    expect(result.rendered).toHaveLength(1);
  });

  test('the summary reports partial selection against the offered rows', () => {
    const result = state({ batch: binding('session', ['s1']) });
    expect(result.folderSummary).toEqual({ count: 1, all: false, some: true });
  });

  test('archived rows are not offered while the filter hides them', () => {
    const result = state({
      batch: binding('session', []),
      sessions: [...sessions(2), ...sessions(1, 1)],
      showArchived: false,
    });
    expect(result.selectableIds).toEqual(['s0', 's1']);
  });
});

describe('folderBatchState in workspace mode', () => {
  test('the header owns the FOLDER id, and rows stay ordinary', () => {
    const result = state({ batch: binding('workspace', []) });
    expect(result.folderCheckbox).toBe(true);
    expect(result.sessionCheckboxes).toBe(false);
    expect(result.selectableIds).toEqual(['7']);
    // The window is untouched: workspace mode selects folders, not rows.
    expect(result.rendered).toHaveLength(1);
    expect(result.hiddenCount).toBe(2);
  });

  test('a selected folder reads as all of its own one-id scope', () => {
    const result = state({ batch: binding('workspace', ['7']) });
    expect(result.folderSummary).toEqual({ count: 1, all: true, some: false });
  });
});
