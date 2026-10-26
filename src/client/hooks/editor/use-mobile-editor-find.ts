/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The phone editor's find bar, and the search row's hand-off, as one call.
 *
 * Both are the DESKTOP's own hooks (`useEditorFind`, `useMobileReveal`) — the phone was
 * the one surface with no way to search a file, and a second implementation would be a
 * second answer to "which occurrences count". What this module adds is the pairing: the
 * marks a search row asks to paint and the marks the bar paints are the same field, so a
 * caller that wired them separately would have to decide which one wins.
 *
 * The bar wins while it is open: a user who typed a query is asking about THAT, and the
 * row's hit is already where the caret is.
 */

import type { CodeSurfaceHandle } from '@/client/components/common/code-surface';
import { useEditorFind } from '@/client/hooks/editor/use-editor-find';
import type { EditorFindState } from '@/client/hooks/editor/find-state';
import { useMobileReveal } from '@/client/hooks/editor/use-mobile-reveal';

interface UseMobileEditorFindOptions {
  path: string | null;
  content: string;
  documentKey: string;
  ready: boolean;
  surfaceRef: { current: CodeSurfaceHandle | null };
  toggleWordWrap: () => void;
}

export interface MobileEditorFind {
  find: EditorFindState;
  /** The marks to paint, or undefined when there is nothing to paint. */
  revealMarks: readonly { start: number; end: number }[] | undefined;
  currentMark: number;
}

export function useMobileEditorFind({
  path,
  content,
  documentKey,
  ready,
  surfaceRef,
  toggleWordWrap,
}: UseMobileEditorFindOptions): MobileEditorFind {
  const reveal = useMobileReveal({ path, content, ready, surfaceRef });
  const find = useEditorFind({
    text: content,
    documentKey,
    readSelection: () => surfaceRef.current?.getSelection() ?? null,
    select: (start, end, focus = true) => surfaceRef.current?.select(start, end, focus),
    reveal: (offset) => surfaceRef.current?.revealOffset(offset),
    applyDocument: (value, caretStart, caretEnd) => surfaceRef.current?.applyDocument(value, caretStart, caretEnd),
    toggleWordWrap,
  });

  // The bar's own matches take over while it is open: the query is what the user is
  // asking about, and the row's hit is already under the caret.
  if (find.open && find.matches.length > 0) {
    return { find, revealMarks: find.matches, currentMark: find.currentIndex };
  }
  return {
    find,
    revealMarks: reveal.matches.length > 0 ? reveal.matches : undefined,
    currentMark: reveal.currentIndex,
  };
}
