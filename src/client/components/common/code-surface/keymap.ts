/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The editor's chords, generated from `EDITOR_KEY_BINDINGS`.
 *
 * The table in `shared/lib/code/editor/keymap.ts` is the ONE statement of what
 * each chord means: the command palette lists it, the find bar's tooltips print
 * it, and this module turns it into CodeMirror bindings. A hand-written CM6
 * keymap would be a second statement that drifts — the palette would advertise
 * `⌥⌘C` for a key CM6 never bound.
 *
 * Panel-owned commands (`find`, `replace`, the match steps, word wrap) are bound
 * HERE too and delegate outward through `onCommand`, so a chord pressed inside
 * the document reaches the same dispatcher the palette uses. Consuming the key
 * is the point: `⌘F` inside the editor must open Kabmo's find bar, never the
 * browser's.
 */

import type { Extension, StateCommand } from '@codemirror/state';
import { EditorSelection } from '@codemirror/state';
import {
  addCursorBelow,
  defaultKeymap,
  copyLineDown,
  copyLineUp,
  cursorDocEnd,
  cursorDocStart,
  cursorLineEnd,
  cursorLineStart,
  deleteLine,
  indentLess,
  indentMore,
  insertBlankLine,
  moveLineDown,
  moveLineUp,
  redo,
  selectDocEnd,
  selectDocStart,
  selectLine,
  selectLineEnd,
  selectLineStart,
  simplifySelection,
  toggleComment,
  undo,
} from '@codemirror/commands';
import { selectNextOccurrence, selectSelectionMatches } from '@codemirror/search';
import { keymap, type Command, type EditorView, type KeyBinding } from '@codemirror/view';

import { EDITOR_KEY_BINDINGS, type EditorCommand } from '@/shared/lib/code/editor/keymap';
import type { KeyStroke } from '@/shared/lib/ui/key-binding';

/** A command as this module invokes it: CM6's `Command` and `StateCommand` both fit. */
type SurfaceCommand = (view: EditorView) => boolean;

/**
 * Insert a blank line ABOVE the caret's line, which CM6 has no command for.
 *
 * The new line carries the current line's own leading whitespace, and the caret
 * lands after it — the rule the textarea surface applied, and the one that makes
 * the key useful inside a block: a bare newline above an indented line left the
 * caret at column 0 and the new line unindented, so the very next thing typed
 * was in the wrong place. (CM6's `insertBlankLine`, used for "below", derives
 * the same indentation from `IndentContext`; this mirrors it without needing a
 * grammar.)
 */
const insertLineAbove: SurfaceCommand = (view) => {
  const { state } = view;
  const range = state.selection.main;
  const line = state.doc.lineAt(range.from);
  const indent = /^[ \t]*/.exec(line.text)?.[0] ?? '';
  view.dispatch({
    changes: { from: line.from, insert: `${indent}\n` },
    selection: { anchor: line.from + indent.length },
  });
  return true;
};

/** Select the word under the caret, or nothing when the caret is between words. */
const selectWord: SurfaceCommand = (view) => {
  const { state } = view;
  const range = state.selection.main;
  if (range.from !== range.to) return false;
  const line = state.doc.lineAt(range.from);
  const offset = range.from - line.from;
  const isWord = (char: string | undefined) => char !== undefined && /[\w$]/.test(char);
  let start = offset;
  let end = offset;
  if (!isWord(line.text[start]) && isWord(line.text[start - 1])) start--;
  if (!isWord(line.text[start])) return false;
  end = start;
  while (isWord(line.text[start - 1])) start--;
  while (isWord(line.text[end])) end++;
  view.dispatch({
    selection: EditorSelection.range(line.from + start, line.from + end),
  });
  return true;
};

/**
 * Collapse extra selections, keeping the main one.
 *
 * Escape's first job when ⌘D left several carets behind; only the next press
 * hands the keyboard back to the page, which the panel's own capture handler
 * does once this reports there was nothing left to collapse.
 */
const collapseSelections: SurfaceCommand = (view) => {
  if (view.state.selection.ranges.length <= 1) return false;
  return (simplifySelection as StateCommand)(view);
};

/**
 * Commands the BUFFER owns. Everything absent from this table is either the
 * panel's (`find`, `replace`, `toggleWordWrap`) or a chord with no meaning in a
 * CM6 surface.
 */
const BUFFER_COMMANDS: Partial<Record<EditorCommand, SurfaceCommand>> = {
  undo: undo as SurfaceCommand,
  redo: redo as SurfaceCommand,
  selectNextOccurrence: selectNextOccurrence as SurfaceCommand,
  selectAllOccurrences: selectSelectionMatches as SurfaceCommand,
  insertCursorBelow: addCursorBelow as SurfaceCommand,
  moveLineUp: moveLineUp as SurfaceCommand,
  moveLineDown: moveLineDown as SurfaceCommand,
  copyLineUp: copyLineUp as SurfaceCommand,
  copyLineDown: copyLineDown as SurfaceCommand,
  deleteLine: deleteLine as SurfaceCommand,
  toggleComment: toggleComment as SurfaceCommand,
  insertLineBelow: insertBlankLine as SurfaceCommand,
  insertLineAbove,
  indent: indentMore as SurfaceCommand,
  outdent: indentLess as SurfaceCommand,
  lineStart: cursorLineStart as SurfaceCommand,
  lineEnd: cursorLineEnd as SurfaceCommand,
  documentStart: cursorDocStart as SurfaceCommand,
  documentEnd: cursorDocEnd as SurfaceCommand,
  selectToLineStart: selectLineStart as SurfaceCommand,
  selectToLineEnd: selectLineEnd as SurfaceCommand,
  selectToDocumentStart: selectDocStart as SurfaceCommand,
  selectToDocumentEnd: selectDocEnd as SurfaceCommand,
  selectWord,
  selectLine: selectLine as SurfaceCommand,
  escape: collapseSelections,
};

/** Run a command against a live view — the palette's and the handle's path in. */
export function runSurfaceCommand(command: EditorCommand, view: EditorView, onCommand?: (command: EditorCommand) => void): boolean {
  const run = BUFFER_COMMANDS[command];
  if (run) return run(view);
  onCommand?.(command);
  return true;
}

/** Codes whose printed name is not their `KeyboardEvent.code` suffix. */
const NAMED_KEYS: Record<string, string> = {
  Enter: 'Enter',
  Escape: 'Escape',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Tab: 'Tab',
  Space: 'Space',
  ArrowUp: 'ArrowUp',
  ArrowDown: 'ArrowDown',
  ArrowLeft: 'ArrowLeft',
  ArrowRight: 'ArrowRight',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
};

const PUNCTUATION_KEYS: Record<string, string> = {
  Slash: '/',
  Backslash: '\\',
  Comma: ',',
  Period: '.',
  Semicolon: ';',
  Quote: "'",
  Backquote: '`',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
};

/**
 * The key CodeMirror names a physical key by, WITHOUT modifiers.
 *
 * CM6 matches on `event.keyCode` through `w3c-keyname`, so the base name is the
 * character the key produces unshifted — `Digit1` is `1`, not `!`, and a
 * `Shift` binding is written `Shift-1`. Punctuation is its US character, which
 * is what that library reports for the same key code.
 */
function baseKey(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3).toLowerCase();
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^F\d{1,2}$/.test(code)) return code;
  return NAMED_KEYS[code] ?? PUNCTUATION_KEYS[code] ?? null;
}

/** `{code:'Digit1', meta:true, shift:true}` → `Meta-Shift-1` (CM6's canonical order). */
export function codeMirrorKey(stroke: KeyStroke): string | null {
  const key = baseKey(stroke.code);
  if (!key) return null;
  let name = key;
  if (stroke.alt) name = `Alt-${name}`;
  if (stroke.ctrl) name = `Ctrl-${name}`;
  if (stroke.meta) name = `Meta-${name}`;
  if (stroke.shift) name = `Shift-${name}`;
  return name;
}

/**
 * One CM6 binding per keymap row, carrying each platform's own chord.
 *
 * `key` is the Windows/Linux chord, `mac` the macOS one, and `win` the Windows
 * override for the single row that has one (`redo` is `Ctrl-Y` there and
 * `Ctrl-Shift-Z` on Linux). CM6 falls back to `key` when a platform field is
 * absent, so a row without an override needs nothing extra.
 */
function bindingsFor(onCommand?: (command: EditorCommand) => void): KeyBinding[] {
  const bindings: KeyBinding[] = [];
  for (const binding of EDITOR_KEY_BINDINGS) {
    const other = codeMirrorKey(binding.other);
    const mac = codeMirrorKey(binding.mac);
    const win = binding.windows ? codeMirrorKey(binding.windows) : null;
    if (!other && !mac) continue;
    const command = binding.command;
    bindings.push({
      key: other ?? undefined,
      mac: mac ?? undefined,
      win: win ?? undefined,
      run: (view) => runSurfaceCommand(command, view, onCommand),
    });
  }
  return bindings;
}

/**
 * Tab indents and ⇧Tab outdents, exactly as `indentWithTab` does.
 *
 * Written out rather than imported so the row can be dropped when the surface is
 * read-only: a viewer that still indented would edit the document. Leaving the
 * editor with the keyboard is CM6's own answer — `Escape` arms a two-second tab
 * focus mode, after which `Tab` moves focus instead of indenting.
 */
const TAB_BINDINGS: KeyBinding[] = [
  { key: 'Tab', run: indentMore as Command, shift: indentLess as Command },
];

/**
 * The editor's own keymap, as one extension.
 *
 * CM6's `defaultKeymap` is APPENDED rather than omitted: it is what makes the
 * ordinary editing keys work — Enter, Backspace, arrows, Home/End, `Mod-End` to
 * the document end, word-wise movement — and none of that is a Kabmo command.
 * Appending it AFTER our rows is what keeps a chord the table claims from being
 * shadowed by a CM6 default (`Mod-a` is a good example: both mean "select all",
 * but only one of them also moves the selection the way the palette describes).
 */
export function surfaceKeymap(onCommand?: (command: EditorCommand) => void, readOnly = false): Extension {
  const rows = readOnly ? [] : TAB_BINDINGS;
  return keymap.of([...bindingsFor(onCommand), ...rows, ...defaultKeymap]);
}

