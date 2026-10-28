/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The code surface's prop contract.
 *
 * Split out of `index.tsx` for the repository's per-file ceiling, and it belongs
 * here anyway: the diff panel, the phone's editor and every test that mounts a
 * surface name these, and importing a prop type from the component module couples
 * them to the mount.
 */

import type { CSSProperties } from 'preact';
import type { Extension } from '@codemirror/state';

import type { ShikiThemeNames } from '@/client/components/common/code-surface/shiki';
import type { MarkRange } from '@/client/components/common/code-surface/marks';
import type { EditorCommand } from '@/shared/lib/code/editor/keymap';
import type { EditorTypingOptions } from '@/client/components/common/code-surface/typing';

export interface CodeSurfaceProps {
  value: string;
  onValueChange: (value: string) => void;
  /** Shiki language id, already resolved from the file name. */
  language: string;
  wordWrap: boolean;
  /** Which cached `EditorState` this document owns — a tab switch applies another. */
  documentKey: string;
  /** Find matches (document offsets) to paint; the current one is marked. */
  marks?: readonly MarkRange[];
  currentMark?: number;
  /** Commands the editor does not own (find bar chords, word wrap, save). */
  onCommand?: (command: EditorCommand) => void;
  /** A viewer: both `readOnly` and `editable(false)`, so nothing can write. */
  readOnly?: boolean;
  /**
   * The editor THEME, as CSS custom properties (`editorThemeVars`).
   *
   * Written on the host element, so the chrome repaints through CSS and a theme
   * switch costs one attribute write. Empty/absent means `auto`: every
   * declaration in `theme.ts` falls back to the app palette.
   */
  themeVars?: Record<string, string>;
  /** The two Shiki theme names to tokenize with (the same theme twice when the
   *  editor theme is explicit). Defaults to the app's dual pair. */
  themes?: ShikiThemeNames;
  /**
   * One indentation level, as a whitespace string (`'  '`, `'    '`, `'\t'`).
   *
   * The setting reaches the editor through the settings event, not through a prop
   * captured at boot; this is what the owner resolved from it. Defaults to two
   * spaces, which is what the surface hardcoded before the setting existed.
   */
  indentUnitText?: string;
  /**
   * Auto-close brackets and the document-words completer.
   *
   * Both change what TYPING does, so both are settings; the surface takes the resolved
   * value and reconfigures a compartment when it moves, which keeps an open tab's undo
   * history.
   */
  typing?: EditorTypingOptions;
  /**
   * Line blame: the labels, the card and the state they read — or `null`.
   *
   * Built by the owner (`blameExtensions`) because the controller behind it
   * needs the file's identity, which the surface does not have. `null` is off,
   * and the surface reconfigures a compartment when it moves, so pressing the
   * toggle does not cost an open tab its undo history.
   */
  blame?: Extension | null;
  /** Font family / size / line height (the zoom control and the font setting). */
  style?: CSSProperties;
  /** Padding around the document, in px. */
  padding?: number;
  /** `data-testid` for the scroller, so the e2e layer can address it. */
  scrollTestId?: string;
  /**
   * The caret's line and column, reported whenever either moves.
   *
   * Separate from the state the surface caches: a status readout wants two numbers,
   * and keeping an `EditorState` for them would pin a document snapshot in a
   * component that prints its line number.
   */
  onCaret?: (position: { line: number; column: number }) => void;
  /**
   * The element that actually scrolls, reported on mount and cleared on unmount.
   *
   * It exists only once the view does, and it is CodeMirror's (`view.scrollDOM`)
   * — a caller that needs to remember the reader's position (`useScrollRestore`)
   * cannot reach it through a `ref`, so the surface hands it over.
   */
  onScroller?: (element: HTMLElement | null) => void;
  /**
   * Text drawn while the document is empty.
   *
   * An open file with no bytes is a fact the panel should state: an unlabelled
   * blank surface reads as a read that has not finished.
   */
  placeholder?: string;
  className?: string;
}
