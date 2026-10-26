/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Landing a search row's hit in the editor.
 *
 * The hand-off has one subtle rule and it is the whole reason this is a hook: the
 * resolved target is RECOMPUTED on every edit (its marks track the live buffer),
 * but the JUMP must fire once per request. Keying an effect on the target itself
 * would drag the view back to the match after every keystroke — the user types one
 * character and the caret jumps away.
 *
 * The request object is the identity: `useSearchRevealTarget` hands back the same
 * object for the same request and a new one for a new hit, so comparing it is both
 * necessary and sufficient.
 */

import { useEffect, useRef } from 'preact/hooks';

import type { FindOptions } from '@/shared/lib/code/editor/find-scan';

/** What `useSearchRevealTarget` answers, as this hook needs it. */
export interface SearchRevealTarget {
  request: {
    query: string;
    options: FindOptions;
    line: number;
  };
}

interface UseSearchRevealJumpOptions {
  /** The resolved target, or null while the buffer is not trustworthy. */
  searchReveal: SearchRevealTarget | null;
  revealMatch: (request: { query: string; options: FindOptions; line: number }) => void;
}

export function useSearchRevealJump({ searchReveal, revealMatch }: UseSearchRevealJumpOptions): void {
  // The callback is rebuilt whenever the find state moves, so it is read through a
  // ref: putting it in the dependency list would re-run the jump on every keystroke
  // in the query field.
  const revealRef = useRef(revealMatch);
  revealRef.current = revealMatch;
  /** The request already served, so a re-render cannot re-fire it. */
  const firedRef = useRef<unknown>(null);

  useEffect(() => {
    if (!searchReveal || firedRef.current === searchReveal.request) return;
    firedRef.current = searchReveal.request;
    revealRef.current({
      query: searchReveal.request.query,
      options: searchReveal.request.options,
      line: searchReveal.request.line,
    });
  }, [searchReveal]);
}
