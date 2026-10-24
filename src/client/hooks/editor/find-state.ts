/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The editor find bar's two contracts, split out of the hook that implements
 * them.
 *
 * The widget, the document and the hook's own tests all type against these, and
 * the hook was at the repository's line ceiling — the state shape is a
 * description of the feature, not part of its behaviour, so it lives where a
 * reader can see the whole contract in one screen.
 */

import type { EditorCommand } from '@/shared/lib/code/editor/keymap';
import type { FindOptions } from '@/shared/lib/code/editor/find-scan';

export interface UseEditorFindOptions {
  /** The buffer on screen. */
  text: string;
  /** Identity of the open document — a switch re-seeds the current match. */
  documentKey: string;
  /** Current selection, used to seed the query the way VS Code does. */
  readSelection: () => { start: number; end: number } | null;
  select: (start: number, end: number, focus?: boolean) => void;
  reveal: (offset: number) => void;
  /** Replace the buffer as ONE undoable edit; focus stays where the caller wants it. */
  applyDocument: (value: string, caretStart: number, caretEnd: number) => void;
  /** ⌥Z / Alt+Z — word wrap belongs to the editor panel, not to this hook. */
  toggleWordWrap?: () => void;
}

export interface EditorFindState {
  open: boolean;
  replaceOpen: boolean;
  query: string;
  replacement: string;
  options: FindOptions;
  matches: readonly { start: number; end: number }[];
  /** The document holds more matches than the cap. */
  truncated: boolean;
  /** The query does not compile as a regex — a different answer from "no matches". */
  invalid: boolean;
  currentIndex: number;
  setQuery: (value: string) => void;
  setReplacement: (value: string) => void;
  openFind: () => void;
  openReplace: () => void;
  /** Expand/collapse the replace row without changing which match is current. */
  toggleReplace: () => void;
  /** Bumped on every "open find" so the widget can refocus its field. */
  focusRequest: number;
  close: () => void;
  /** Dispatch a keymap command (⌘F, F3, ⌥⌘C, …). */
  runCommand: (command: EditorCommand) => void;
  /**
   * Point the editor at a search hit: re-aim the matcher at the query and put
   * the caret on the match on `line` (1-based). Every occurrence of the query in
   * the file is painted; the bar is left CLOSED, so the jump does not cover the
   * lines it is showing.
   */
  revealMatch: (request: { query: string; options: FindOptions; line: number }) => void;
  toggleOption: (key: keyof FindOptions) => void;
  step: (direction: 1 | -1) => void;
  replaceCurrent: () => void;
  replaceAll: () => void;
}
