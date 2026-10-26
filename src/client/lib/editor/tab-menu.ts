/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The tab strip's right-click menu.
 *
 * One tab, many ways to close it — and the difference between them is the whole
 * reason the menu exists. `Close` on a strip of twelve tabs is not the operation
 * people want; they want the other eleven gone, or the saved ones gone, or the one
 * they closed by accident back.
 *
 * ## The rows are DATA, and the ones that cannot apply are ABSENT
 *
 * `Close saved` with no saved tabs, `Reopen closed` with an empty stack: a row that
 * is always present and always refuses reads as a broken menu. `buildTabMenuRows`
 * decides which exist, so the component only draws them — the same split the Files
 * panel's row menu uses.
 *
 * ## `Reopen` is a stack, and it lives with the tab list
 *
 * It needs the closed `OpenedFile` kept WHOLE (name, path, scope, and whether it was a
 * diff), because reopening reconstructs the tab rather than re-deriving it from a path.
 * The stack is therefore owned by `useFileTabs`, next to `handleCloseFile` — a second
 * copy elsewhere would be a second answer to "what was closed".
 */

import type { OpenedFile } from '@/shared/types/fs';
import { canSplitTo } from '@/shared/lib/workspace/split-editor';

/** What a tab menu row asks for. */
export type TabMenuAction =
  | 'split-right'
  | 'unsplit'
  | 'close'
  | 'close-others'
  | 'close-all'
  | 'close-saved'
  | 'copy-path'
  | 'reveal-in-files'
  | 'reopen-closed';

export interface TabMenuRow {
  action: TabMenuAction;
  label: string;
  /** A row that cannot apply here is absent, not disabled. */
  enabled: boolean;
}

interface BuildTabMenuRowsOptions {
  /** The tab the menu was opened on. */
  tab: OpenedFile;
  /** Every open tab. */
  openedFiles: readonly OpenedFile[];
  /** Tab ids whose buffer holds edits that are not on disk. */
  dirtyIds: ReadonlySet<string | number>;
  /** How many closed tabs can still be reopened. */
  reopenable: number;
  /** The LEFT pane's tab: the tab the split would be divided FROM. */
  activeFileId: string | number | null;
  /** The tab the right pane currently shows, or null when the column is unsplit. */
  splitRightFileId: string | number | null;
}

/**
 * The rows this menu offers, in the order a reader looks for them.
 *
 * `Close others` and `Close all` are absent when they would close nothing, and
 * `Close saved` is absent when every open tab is dirty — a row that would do nothing
 * is noise in a menu whose whole point is that each row does one thing.
 */
export function buildTabMenuRows({
  tab,
  openedFiles,
  dirtyIds,
  reopenable,
  activeFileId,
  splitRightFileId,
}: BuildTabMenuRowsOptions): TabMenuRow[] {
  const others = openedFiles.filter((file) => file.id !== tab.id);
  const saved = openedFiles.filter((file) => !dirtyIds.has(file.id));
  const openIds = openedFiles.map((file) => file.id);
  const rows: TabMenuRow[] = [
    // Split rows sit FIRST, above the closes: they are the only rows here that ADD
    // something, and a menu whose first four rows all destroy is a menu you read slowly.
    { action: 'split-right', label: 'Split right', enabled: canSplitTo(tab.id, activeFileId, openIds) },
    { action: 'unsplit', label: 'Unsplit', enabled: splitRightFileId !== null },
    { action: 'close', label: 'Close', enabled: true },
    { action: 'close-others', label: 'Close others', enabled: others.length > 0 },
    { action: 'close-all', label: 'Close all', enabled: openedFiles.length > 0 },
    // Only worth a row when there is at least one SAVED tab OTHER than this one — the
    // point of the row is to leave the saved ones behind.
    {
      action: 'close-saved',
      label: 'Close saved',
      enabled: saved.some((file) => file.id !== tab.id),
    },
    { action: 'copy-path', label: 'Copy path', enabled: Boolean(tab.path) },
    { action: 'reveal-in-files', label: 'Reveal in Files', enabled: Boolean(tab.path) && !tab.isDiff },
    { action: 'reopen-closed', label: 'Reopen closed tab', enabled: reopenable > 0 },
  ];
  return rows.filter((row) => row.enabled);
}

/** The ids a menu action leaves open, or null when the action is not a close. */
export function tabIdsAfterClose(
  action: TabMenuAction,
  tab: OpenedFile,
  openedFiles: readonly OpenedFile[],
  dirtyIds: ReadonlySet<string | number>,
): Array<string | number> | null {
  switch (action) {
    case 'close':
      return openedFiles.filter((file) => file.id !== tab.id).map((file) => file.id);
    case 'close-others':
      return [tab.id];
    case 'close-all':
      return [];
    case 'close-saved':
      // The dirty ones stay, which is the only reading that makes the row safe: it
      // cannot lose an edit.
      return openedFiles.filter((file) => dirtyIds.has(file.id)).map((file) => file.id);
    default:
      return null;
  }
}
