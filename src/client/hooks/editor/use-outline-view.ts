/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The outline a surface should show for the file it is drawing, and why it may
 * be empty.
 *
 * The desktop section and the phone's sheet both need the same two answers, and
 * they must agree: a byte viewer has no text to scan, a failed read has no
 * buffer to trust, and a file that simply has no declarations is a different
 * sentence from either. Deriving it once keeps the two surfaces from drifting —
 * and it keeps the scan itself out of both components.
 *
 * The scan runs only in the `ready` state, so a half-read buffer never produces
 * a list of rows that are about to move.
 *
 * Two bounds keep a large file from making the panel the most expensive thing in
 * the editor, and each was measured rather than guessed (see `outline/rows.ts`):
 *
 * - **The scan is DEBOUNCED.** It walks the whole document — 366 ms on 10 MB in
 *   Bun — and the published buffer changes on every keystroke, so a live scan
 *   charged that to typing. Measured in the browser at 10 MB with the panel
 *   open: 704 ms per keystroke live, 34 ms without. A declaration list does not
 *   change mid-word, so the rows are recomputed once the buffer goes quiet.
 * - **The scan is SKIPPED past `MAX_OUTLINE_SCAN_CHARS`**, and the panel says
 *   why instead of showing an empty list that reads as "no declarations here".
 *
 * A DIFFERENT DOCUMENT is scanned at once, never on the timer: rows from the
 * previous file point at lines of a document that is gone.
 */

import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { extractOutline } from '@/shared/lib/code/outline/extract';
import type { OutlineSymbol } from '@/shared/lib/code/outline/types';
import { outlineEmptyNotice, type EditorDocumentState } from '@/shared/lib/code/outline/document';
import { MAX_OUTLINE_SCAN_CHARS, outlineTooLargeNotice, outlineWindow } from '@/shared/lib/code/outline/rows';

/**
 * How long the buffer must be quiet before the outline is re-scanned.
 *
 * Long enough that typing never pays for it, short enough that the rows are
 * back before the reader looks for them — and sooner than the 800 ms autosave,
 * so the outline still describes the buffer before the file on disk does.
 */
export const OUTLINE_SCAN_DELAY_MS = 300;

export interface OutlineView {
  /** The rows to render — bounded by `MAX_OUTLINE_ROWS`. */
  symbols: OutlineSymbol[];
  /** Every symbol the scan found, including the ones not rendered. */
  total: number;
  /** True when the panel is showing only the first `MAX_OUTLINE_ROWS`. */
  truncated: boolean;
  /** The sentence to print when `symbols` is empty. */
  notice: string;
}

export interface OutlineSource {
  /** The live buffer. */
  content: string;
  /** Shiki language id. */
  language: string;
  /** The document's own state, so "still reading" is not "no symbols". */
  state: EditorDocumentState;
  note: string | null;
  /**
   * Identity of the document being drawn. A change here scans IMMEDIATELY
   * instead of on the timer — see the module note.
   */
  path: string | null;
}

interface ScanInput {
  content: string;
  language: string;
  path: string | null;
}

/** Too large to outline: no scan, and a sentence that names the reason. */
function tooLarge(content: string): boolean {
  return content.length > MAX_OUTLINE_SCAN_CHARS;
}

export function useOutlineView({ content, language, state, note, path }: OutlineSource): OutlineView {
  // Seeded from the mount values, so the first document's outline is ready on
  // the first render rather than one timer later.
  const [scan, setScan] = useState<ScanInput>({ content, language, path });
  const pathRef = useRef(path);

  useEffect(() => {
    const documentChanged = path !== pathRef.current;
    pathRef.current = path;
    // A document past the ceiling is never scanned, so there is nothing to
    // schedule — and re-arming a timer per keystroke on a file the panel will
    // not describe is work for a sentence that never changes.
    if (documentChanged || tooLarge(content)) {
      setScan((prev) =>
        prev.content === content && prev.language === language ? prev : { content, language, path },
      );
      return;
    }
    // Trailing debounce: every keystroke re-arms it, so the scan runs once the
    // buffer goes quiet. The updater returns `prev` when nothing moved, which
    // makes the mount's own timer a no-op instead of a second scan of the same
    // text.
    const timer = window.setTimeout(() => {
      setScan((prev) =>
        prev.content === content && prev.language === language ? prev : { content, language, path },
      );
    }, OUTLINE_SCAN_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [path, content, language]);

  const symbols = useMemo(() => {
    if (state !== 'ready' || tooLarge(scan.content)) return [];
    return extractOutline(scan.content, scan.language);
  }, [state, scan]);

  const visible = useMemo(() => outlineWindow(symbols), [symbols]);
  // The LIVE length, not the scanned one: the sentence names the file's size as
  // it is now, and reading it off `scan` would make it lag a debounce behind.
  const tooLargeNotice = state === 'ready' ? outlineTooLargeNotice(content.length) : null;

  return {
    symbols: visible.rows,
    total: visible.total,
    truncated: visible.truncated,
    // The size refusal wins over the empty-state sentence: "too large to
    // outline" is the reason, and the generic one would hide it.
    notice: tooLargeNotice ?? outlineEmptyNotice(state, note),
  };
}
