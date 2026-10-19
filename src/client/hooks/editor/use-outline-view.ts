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
 */

import { useMemo } from 'preact/hooks';
import { extractOutline } from '@/shared/lib/code/outline/extract';
import type { OutlineSymbol } from '@/shared/lib/code/outline/types';
import { outlineEmptyNotice, type EditorDocumentState } from '@/shared/lib/code/outline/document';

export interface OutlineView {
  symbols: OutlineSymbol[];
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
}

export function useOutlineView({ content, language, state, note }: OutlineSource): OutlineView {
  const symbols = useMemo(
    () => (state === 'ready' ? extractOutline(content, language) : []),
    [state, content, language],
  );
  return { symbols, notice: outlineEmptyNotice(state, note) };
}
