/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The desktop editor's status bar: where the caret is, how the file is indented, and
 * how it ends.
 *
 * The phone has had a status strip since the editor was rebuilt (`lines · chars ·
 * language`); the desktop pane had nothing, so the only way to know the caret's line
 * was to count. This is the missing half, and it is also where the two settings that
 * change the BYTES of a save are reported — the indent unit and the line ending —
 * because a user who cannot see them cannot tell whether a 4-space repository is
 * being indented correctly.
 *
 * ## It does not hide
 *
 * The panel has a 320px floor (`MIN_EDITOR_PANEL_WIDTH`), so there is always room for
 * one 24px row — and a readout that disappears at some widths is a readout the user
 * cannot rely on. A container query was tried and removed: the strip's own root has no
 * `@container` ancestor, so `@[240px]:flex` never matched and the row was `hidden` at
 * every width, which a test caught rather than a reader.
 *
 * ## The right half is the SAVE state, not a second copy of the toolbar's
 *
 * The toolbar already shows saving/saved/error through its icon. Repeating it here
 * would be two indicators for one fact, so the right half carries only what the
 * toolbar cannot: the file's own line ending, and the language the surface resolved.
 */

import { VIEWER_LABELS, type ViewerKind } from '@/shared/lib/fs/document-kind';
import type { CaretPosition } from '@/client/hooks/editor/caret-position';
import type { LineEnding } from '@/shared/lib/code/line-endings';

interface EditorStatusBarProps {
  /** `null` before the surface reports a state, and for a byte viewer. */
  caret: CaretPosition | null;
  /** The file's own ending, which the next save restores. */
  eol: LineEnding;
  /** Change the ending the next save writes. */
  onSetEol: (eol: LineEnding) => void;
  /** One indentation level, already resolved from the setting. */
  indentWidth: number;
  insertSpaces: boolean;
  /** The Shiki language id the surface resolved. */
  language: string;
  /** A byte-drawing viewer prints its KIND instead of a caret. */
  byteViewer: boolean;
  viewerKind: ViewerKind;
  lineCount: number;
}

/** `Spaces: 2` / `Tabs`, which is what the indent actually inserts. */
function indentLabel(width: number, insertSpaces: boolean): string {
  return insertSpaces ? `Spaces: ${width}` : 'Tabs';
}

export function EditorStatusBar({
  caret,
  eol,
  onSetEol,
  indentWidth,
  insertSpaces,
  language,
  byteViewer,
  viewerKind,
  lineCount,
}: EditorStatusBarProps) {
  return (
    <footer
      className="flex bg-canvas border-t border-ink/10 px-3 items-center justify-between text-[10px] text-ink/50 flex-shrink-0 font-mono h-6"
      data-editor-status-bar=""
    >
      <div className="flex items-center gap-3 min-w-0">
        {byteViewer ? (
          <span className="uppercase">{VIEWER_LABELS[viewerKind]}</span>
        ) : (
          <>
            {/* `Ln 12, Col 34` is the shape every editor uses, and it is also what a
                stack trace gives the user to look for. */}
            <span className="tabular-nums">
              {caret ? `Ln ${caret.line}, Col ${caret.column}` : 'Ln —, Col —'}
            </span>
            <span>{indentLabel(indentWidth, insertSpaces)}</span>
            {/* A control, not a label: the ending is a choice the write path already
                carries, and a file that arrived as CRLF had no way to become LF. */}
            <button
              type="button"
              onClick={() => onSetEol(eol === 'lf' ? 'crlf' : 'lf')}
              className="uppercase hover:text-ink transition-colors cursor-pointer"
              title={`Line endings: ${eol.toUpperCase()} — click to switch`}
              aria-label={`Line endings ${eol.toUpperCase()}, switch`}
            >
              {eol}
            </button>
            <span>{lineCount} lines</span>
          </>
        )}
      </div>
      <div className="flex items-center gap-3 min-w-0">
        <span className="uppercase text-ink/40">{language}</span>
      </div>
    </footer>
  );
}
