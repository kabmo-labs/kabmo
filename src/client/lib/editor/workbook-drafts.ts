/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Edited workbooks that are not on disk yet, keyed by the file they belong to.
 *
 * The grid's edits live in the viewer, and the viewer unmounts when the user
 * switches tabs — so a draft kept in component state would be lost by a glance
 * at another file while the tab still said "edited". This map is the smallest
 * thing that survives that: one entry per workbook with unsaved edits, dropped
 * when the save lands.
 *
 * It is deliberately NOT a cache of every workbook ever opened: a clean
 * workbook is re-read from disk, which is the only copy that can be trusted
 * after an external change.
 */

import type { LoadedWorkbook } from '@/client/components/workspace/editor/viewers/workbook';

export interface WorkbookDraft {
  workbook: LoadedWorkbook;
  dirty: boolean;
}

const drafts = new Map<string, WorkbookDraft>();

/** The draft for a file, or undefined when it has none. */
export function draftFor(key: string): WorkbookDraft | undefined {
  return drafts.get(key);
}

/** Keep an edited workbook for a file. */
export function rememberDraft(key: string, draft: WorkbookDraft): void {
  drafts.set(key, draft);
}

/** Drop a file's draft — the save landed, or the edits were discarded. */
export function forgetDraft(key: string): void {
  drafts.delete(key);
}
