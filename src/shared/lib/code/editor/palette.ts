/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The command palette's list, as data.
 *
 * The palette is a VIEW of the keymap rather than a second list to maintain, so
 * the rules live here — pure, testable, and shared with the component. The
 * property that matters most is negative: an entry the keymap does not bind must
 * never appear, because a palette entry that does nothing reads as a broken
 * editor rather than a missing feature.
 */

import { EDITOR_KEY_BINDINGS, type EditorCommand } from '@/shared/lib/code/editor/keymap';
import { describeBinding } from '@/shared/lib/ui/key-binding';

export interface PaletteEntry {
  command: EditorCommand;
  label: string;
  chord: string;
}

/**
 * The palette's running order: what a reader reaches for most, first. The
 * commands are named here rather than derived from the keymap's own order, which
 * groups chords by family for readability rather than by frequency of use.
 */
export const PALETTE_ORDER: readonly EditorCommand[] = [
  'find',
  'goToLine',
  'replace',
  'selectNextOccurrence',
  'selectAllOccurrences',
  'insertCursorBelow',
  'insertCursorAbove',
  'selectLine',
  'toggleComment',
  'toggleBlockComment',
  'joinLines',
  'trimTrailingWhitespace',
  'moveLineUp',
  'moveLineDown',
  'copyLineUp',
  'copyLineDown',
  'deleteLine',
  'insertLineBelow',
  'insertLineAbove',
  'indent',
  'outdent',
  'fold',
  'unfold',
  'foldAll',
  'unfoldAll',
  'toggleWordWrap',
  'toggleCaseSensitive',
  'toggleWholeWord',
  'toggleRegex',
  'undo',
  'redo',
  'lineStart',
  'lineEnd',
  'documentStart',
  'documentEnd',
  'selectToLineStart',
  'selectToLineEnd',
  'selectToDocumentStart',
  'selectToDocumentEnd',
  'nextMatch',
  'previousMatch',
  'replaceOne',
  'replaceAll',
];

/**
 * The entries, built from the keymap so a command cannot be listed and unbound.
 * A command in `PALETTE_ORDER` that the keymap dropped is skipped rather than
 * rendered with an empty chord.
 */
export function buildPaletteEntries(isMac: boolean): PaletteEntry[] {
  return PALETTE_ORDER.flatMap((command) => {
    const binding = EDITOR_KEY_BINDINGS.find((entry) => entry.command === command);
    if (!binding) return [];
    return [{ command, label: binding.label, chord: describeBinding(binding, isMac) }];
  });
}

/**
 * The entries a query matches. Matched on the label, the chord and the command
 * name: typing `⌘d` finds the same command as typing `occurrence`, which is how
 * a reader who already knows the shortcut looks for it.
 */
export function filterPaletteEntries(entries: readonly PaletteEntry[], query: string): readonly PaletteEntry[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return entries;
  const parts = needle.split(/\s+/);
  return entries.filter((entry) => {
    const haystack = `${entry.label} ${entry.chord} ${entry.command}`.toLowerCase();
    return parts.every((part) => haystack.includes(part));
  });
}
