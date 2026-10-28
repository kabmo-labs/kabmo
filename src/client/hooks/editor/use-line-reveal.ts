/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The editor's end of an outline row's hand-off.
 *
 * A row publishes a `LineRevealRequest` and opens the file; this hook resolves
 * it against the LIVE buffer, but it deliberately does NOT clear the store —
 * "served" is the caller's word, because only the caller knows whether the
 * surface that must move actually exists (`use-line-jump.ts` clears it after
 * applying). Consuming here was wrong in one visible way: with the editor panel
 * collapsed there is no surface, the request was cleared anyway, and reopening
 * the panel left the jump gone with nothing to show it had ever been asked for.
 *
 * It does NOT open the find bar: a symbol jump names a declaration, and the bar
 * would cover the line it was asked to show. That is the difference from
 * `useSearchRevealTarget`, and the reason the two requests are separate stores.
 */

import { useMemo } from 'preact/hooks';
import { useSyncExternalStore } from 'preact/compat';
import { lineStartOffset } from '@/shared/lib/code/editor/lines';
import { getLineReveal, subscribeLineReveal } from '@/client/lib/line-reveal';

export interface LineRevealTarget {
  /** The path the request named, so a caller can tell it apart from the file on screen. */
  path: string;
  /** Start of the line, which is where the view scrolls to. */
  offset: number;
  /** Start of the selection: the name's own column when the row named one. */
  selectionStart: number;
  /** End of the selection: the name's last character, or `selectionStart` for a bare caret. */
  selectionEnd: number;
  /** The request object itself — the identity a caller keys its "fired" ref on. */
  request: object;
}

/**
 * The pending request, resolved for `path`, or null while there is none.
 *
 * `ready` is the caller's "the buffer is trustworthy" signal: a file still
 * loading, one whose read failed, and a tab with no text at all must leave the
 * request pending rather than resolve it against an empty document.
 */
export function useLineRevealTarget(
  path: string | null,
  content: string,
  ready: boolean,
): LineRevealTarget | null {
  const reveal = useSyncExternalStore(subscribeLineReveal, getLineReveal);

  return useMemo(() => {
    if (!reveal || !path || reveal.path !== path || !ready) return null;
    const offset = lineStartOffset(content, Math.max(0, reveal.line - 1));
    // The column is resolved against the LIVE line, not trusted blindly: an
    // edit that shortened the line must not push the selection past its end.
    const lineEnd = content.indexOf('\n', offset);
    const lineLength = (lineEnd === -1 ? content.length : lineEnd) - offset;
    const start = Math.min(lineLength, Math.max(0, (reveal.column ?? 1) - 1));
    const end = reveal.length === undefined ? start : Math.min(lineLength, start + reveal.length);
    return {
      path,
      offset,
      selectionStart: offset + start,
      selectionEnd: offset + end,
      request: reveal,
    };
  }, [reveal, path, ready, content]);
}
