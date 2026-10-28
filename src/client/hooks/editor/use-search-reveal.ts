/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The editor's end of a search-result hand-off.
 *
 * A result row publishes a `SearchRevealRequest` and opens the file; this hook
 * waits until THAT file's bytes are on screen, then keeps the request while the
 * document stays open so the consumer can paint every occurrence and aim the
 * caret at the one the row named.
 *
 * Two rules are load-bearing:
 *
 * - **The request is resolved against the LIVE buffer.** The marks are
 *   recomputed from the current text on every render, so editing the file after
 *   jumping to a hit keeps the highlights in the right places — the same reason
 *   the find bar re-runs its own matcher on every keystroke.
 * - **The request is consumed exactly once.** It is cleared as soon as it is
 *   served, because the target it produced is held here: without that, a
 *   re-render (or the panel re-mounting) would re-fire the caret jump and drag
 *   the view back to the match the user has since scrolled away from.
 *
 * The request is deliberately NOT persisted: it is served the moment the file
 * opens, and a request restored from storage would fire again on reload.
 */

import { useEffect, useMemo, useState } from 'preact/hooks';
import { useSyncExternalStore } from 'preact/compat';

import { findMatches, lineStartOffset, matchIndexAtOrAfter } from '@/shared/lib/code/editor/find-scan';
import {
  getSearchReveal,
  setSearchReveal,
  subscribeSearchReveal,
  type SearchRevealRequest,
} from '@/client/lib/search-reveal';

export interface SearchRevealTarget {
  request: SearchRevealRequest;
  /** Every occurrence of the query in the buffer, in document order. */
  matches: { start: number; end: number }[];
  /** Index into `matches` of the hit the row named, or -1 when none is left. */
  currentIndex: number;
}

/**
 * The served request for `path`, or null while there is none.
 *
 * `ready` is the caller's "the buffer is trustworthy" signal — a file still
 * loading, or one whose read failed, has no text to match against and the
 * request must wait rather than be consumed against an empty buffer.
 */
export function useSearchRevealTarget(path: string | null, content: string, ready: boolean): SearchRevealTarget | null {
  const reveal = useSyncExternalStore(subscribeSearchReveal, getSearchReveal);
  const [served, setServed] = useState<{ request: SearchRevealRequest; path: string } | null>(null);

  useEffect(() => {
    if (!reveal || !path || reveal.path !== path || !ready) return;
    setServed({ request: reveal, path });
    // Served: the next request must be a new one, not this one re-fired.
    setSearchReveal(null);
  }, [reveal, path, ready]);

  return useMemo(() => {
    // The served request is dropped the moment the editor holds a DIFFERENT
    // file: its marks are offsets into a buffer that is no longer on screen.
    if (!served || served.path !== path) return null;
    const { matches } = findMatches(content, served.request.query, served.request.options);
    const offset = lineStartOffset(content, Math.max(0, served.request.line - 1));
    return { request: served.request, matches, currentIndex: matchIndexAtOrAfter(matches, offset) };
  }, [served, path, content]);
}
