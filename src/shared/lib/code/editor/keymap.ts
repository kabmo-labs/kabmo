/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The code editor's keymap, as data.
 *
 * One table is the whole truth about an editor shortcut: what it does, which
 * chords reach it on each platform, and what the palette calls it. The
 * generated CodeMirror keymap, the find bar's buttons, the tooltips and the
 * command palette all read this table, so a shortcut cannot be listed in the
 * palette and unbound in the editor.
 *
 * VS Code's defaults are followed wherever this editor has an equivalent. Where
 * it has none — folding, go-to-definition, the `⌘K` prefix chords — the command
 * is absent rather than bound to something that would surprise.
 */

import type { KeyBinding, KeyStroke } from '@/shared/lib/ui/key-binding';

export type EditorCommand =
  | 'find'
  | 'replace'
  | 'nextMatch'
  | 'previousMatch'
  | 'replaceOne'
  | 'replaceAll'
  | 'toggleCaseSensitive'
  | 'toggleWholeWord'
  | 'toggleRegex'
  | 'toggleWordWrap'
  | 'selectNextOccurrence'
  | 'selectAllOccurrences'
  | 'insertCursorBelow'
  | 'moveLineUp'
  | 'moveLineDown'
  | 'copyLineUp'
  | 'copyLineDown'
  | 'deleteLine'
  | 'toggleComment'
  | 'insertLineBelow'
  | 'insertLineAbove'
  | 'indent'
  | 'outdent'
  | 'undo'
  | 'redo'
  | 'lineStart'
  | 'lineEnd'
  | 'documentStart'
  | 'documentEnd'
  | 'selectToLineStart'
  | 'selectToLineEnd'
  | 'selectToDocumentStart'
  | 'selectToDocumentEnd'
  | 'selectWord'
  | 'selectLine'
  | 'escape';

/**
 * The editor keymap.
 *
 * Every entry carries both platforms even when the chords are identical,
 * because the label is DERIVED from the stroke rather than written twice — a
 * hand-written "Ctrl+F" beside a binding that listens for ⌘F is exactly the
 * drift this table exists to prevent.
 */
export const EDITOR_KEY_BINDINGS: readonly KeyBinding<EditorCommand>[] = [
  { command: 'find', label: 'Find', mac: { code: 'KeyF', meta: true }, other: { code: 'KeyF', ctrl: true } },
  { command: 'replace', label: 'Replace', mac: { code: 'KeyF', meta: true, alt: true }, other: { code: 'KeyH', ctrl: true } },
  { command: 'nextMatch', label: 'Next match', mac: { code: 'F3' }, other: { code: 'F3' } },
  { command: 'previousMatch', label: 'Previous match', mac: { code: 'F3', shift: true }, other: { code: 'F3', shift: true } },
  { command: 'replaceOne', label: 'Replace current match', mac: { code: 'Digit1', meta: true, shift: true }, other: { code: 'Digit1', ctrl: true, shift: true } },
  { command: 'replaceAll', label: 'Replace all matches', mac: { code: 'Enter', meta: true, alt: true }, other: { code: 'Enter', ctrl: true, alt: true } },
  { command: 'toggleCaseSensitive', label: 'Match case', mac: { code: 'KeyC', meta: true, alt: true }, other: { code: 'KeyC', alt: true } },
  { command: 'toggleWholeWord', label: 'Match whole word', mac: { code: 'KeyW', meta: true, alt: true }, other: { code: 'KeyW', alt: true } },
  { command: 'toggleRegex', label: 'Use regular expression', mac: { code: 'KeyR', meta: true, alt: true }, other: { code: 'KeyR', alt: true } },
  { command: 'toggleWordWrap', label: 'Toggle word wrap', mac: { code: 'KeyZ', alt: true }, other: { code: 'KeyZ', alt: true } },

  { command: 'selectNextOccurrence', label: 'Add selection to next find match', mac: { code: 'KeyD', meta: true }, other: { code: 'KeyD', ctrl: true } },
  { command: 'selectAllOccurrences', label: 'Select all occurrences of current selection', mac: { code: 'KeyL', meta: true, shift: true }, other: { code: 'KeyL', ctrl: true, shift: true } },
  { command: 'insertCursorBelow', label: 'Insert cursor below', mac: { code: 'KeyD', meta: true, shift: true }, other: { code: 'KeyD', ctrl: true, shift: true } },

  { command: 'moveLineUp', label: 'Move line up', mac: { code: 'ArrowUp', alt: true }, other: { code: 'ArrowUp', alt: true } },
  { command: 'moveLineDown', label: 'Move line down', mac: { code: 'ArrowDown', alt: true }, other: { code: 'ArrowDown', alt: true } },
  { command: 'copyLineUp', label: 'Copy line up', mac: { code: 'ArrowUp', meta: true, alt: true, shift: true }, other: { code: 'ArrowUp', ctrl: true, alt: true, shift: true } },
  { command: 'copyLineDown', label: 'Copy line down', mac: { code: 'ArrowDown', meta: true, alt: true, shift: true }, other: { code: 'ArrowDown', ctrl: true, alt: true, shift: true } },
  // `⇧⌘K` on macOS; VS Code's Windows/Linux chord is the two-stroke `Ctrl+K Ctrl+K`,
  // which a single-stroke table cannot express, so the mac chord is used there too.
  { command: 'deleteLine', label: 'Delete line', mac: { code: 'KeyK', meta: true, shift: true }, other: { code: 'KeyK', ctrl: true, shift: true } },
  // `Slash` is a physical key: on a US layout that is `/`, elsewhere it is
  // wherever the user's own layout puts it.
  { command: 'toggleComment', label: 'Toggle line comment', mac: { code: 'Slash', meta: true }, other: { code: 'Slash', ctrl: true } },

  { command: 'insertLineBelow', label: 'Insert line below', mac: { code: 'Enter', meta: true }, other: { code: 'Enter', ctrl: true } },
  { command: 'insertLineAbove', label: 'Insert line above', mac: { code: 'Enter', meta: true, shift: true }, other: { code: 'Enter', ctrl: true, shift: true } },

  { command: 'indent', label: 'Indent line', mac: { code: 'BracketRight', meta: true }, other: { code: 'BracketRight', ctrl: true } },
  { command: 'outdent', label: 'Outdent line', mac: { code: 'BracketLeft', meta: true }, other: { code: 'BracketLeft', ctrl: true } },

  { command: 'undo', label: 'Undo', mac: { code: 'KeyZ', meta: true }, other: { code: 'KeyZ', ctrl: true } },
  {
    command: 'redo',
    label: 'Redo',
    mac: { code: 'KeyZ', meta: true, shift: true },
    other: { code: 'KeyZ', ctrl: true, shift: true },
    windows: { code: 'KeyY', ctrl: true },
  },

  { command: 'lineStart', label: 'Go to line start', mac: { code: 'ArrowLeft', meta: true }, other: { code: 'Home' } },
  { command: 'lineEnd', label: 'Go to line end', mac: { code: 'ArrowRight', meta: true }, other: { code: 'End' } },
  { command: 'documentStart', label: 'Go to file start', mac: { code: 'ArrowUp', meta: true }, other: { code: 'ArrowUp', ctrl: true } },
  { command: 'documentEnd', label: 'Go to file end', mac: { code: 'ArrowDown', meta: true }, other: { code: 'ArrowDown', ctrl: true } },
  { command: 'selectToLineStart', label: 'Select to line start', mac: { code: 'ArrowLeft', meta: true, shift: true }, other: { code: 'ArrowLeft', ctrl: true, shift: true } },
  { command: 'selectToLineEnd', label: 'Select to line end', mac: { code: 'ArrowRight', meta: true, shift: true }, other: { code: 'ArrowRight', ctrl: true, shift: true } },
  { command: 'selectToDocumentStart', label: 'Select to file start', mac: { code: 'ArrowUp', meta: true, shift: true }, other: { code: 'ArrowUp', ctrl: true, shift: true } },
  { command: 'selectToDocumentEnd', label: 'Select to file end', mac: { code: 'ArrowDown', meta: true, shift: true }, other: { code: 'ArrowDown', ctrl: true, shift: true } },
];

/**
 * Commands the FIND BAR handles: the editor panel dispatches these to the find
 * hook rather than running them against the buffer itself.
 */
export const FIND_BAR_COMMANDS: readonly EditorCommand[] = [
  'find',
  'replace',
  'nextMatch',
  'previousMatch',
  'replaceOne',
  'replaceAll',
  'toggleCaseSensitive',
  'toggleWholeWord',
  'toggleRegex',
  'toggleWordWrap',
];

/** Membership test for a call site that has a command and wants a yes/no. */
const FIND_BAR_SET: Record<string, true> = Object.fromEntries(FIND_BAR_COMMANDS.map((command) => [command, true]));

export function isFindBarCommand(command: EditorCommand): boolean {
  return FIND_BAR_SET[command] === true;
}

/** The chord for a command on the current platform. */
export function editorStrokeFor(command: EditorCommand, isMac: boolean, isWindows: boolean): KeyStroke | null {
  const binding = EDITOR_KEY_BINDINGS.find((entry) => entry.command === command);
  if (!binding) return null;
  if (isMac) return binding.mac;
  if (binding.windows && isWindows) return binding.windows;
  return binding.other;
}
