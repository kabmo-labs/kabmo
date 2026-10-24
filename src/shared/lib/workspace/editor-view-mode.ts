/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * How wide the editor column is allowed to be, as ONE of three modes.
 *
 * `compact` and `full` both hide the chat timeline and let the editor take the
 * width the chat had; `full` also hides the session sidebar. Neither touches
 * the right panel: the point of the two modes is a wider DOCUMENT, and the
 * right column is where the outline, search hits and the diff list live while
 * it is being read. The third width — the existing `fixed inset-0` full
 * SCREEN — is a different thing entirely (it covers the right panel too) and
 * stays where it is, on its own button.
 *
 * The rules are pure so the layout, both toolbars and the tests read the same
 * table: which columns a mode hides is data, never a condition at a call site.
 */

export type EditorViewMode = 'normal' | 'compact' | 'full';

/** The two modes a toolbar button can name. */
export type EditorViewModeTarget = 'compact' | 'full';

/** Session-state slot. Per session, like every other layout choice. */
export const EDITOR_VIEW_MODE_KEY = 'layout.editorViewMode';

export const DEFAULT_EDITOR_VIEW_MODE: EditorViewMode = 'normal';

/** A stored value written by another build is not a mode this one can draw. */
export function isEditorViewMode(value: unknown): value is EditorViewMode {
  return value === 'normal' || value === 'compact' || value === 'full';
}

/**
 * What a mode HIDES. `full` hides everything `compact` does plus the sidebar,
 * so it is strictly wider — the two are ordered, not alternatives.
 */
export function editorViewHides(mode: EditorViewMode, column: 'chat' | 'sidebar'): boolean {
  if (column === 'chat') return mode === 'compact' || mode === 'full';
  return mode === 'full';
}

/** Clicking the mode a button already names returns to `normal`. */
export function toggledEditorViewMode(current: EditorViewMode, next: EditorViewModeTarget): EditorViewMode {
  return current === next ? 'normal' : next;
}
