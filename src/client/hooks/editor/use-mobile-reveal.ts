/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Serving a search row's hand-off in the PHONE's full-screen editor.
 *
 * The desktop pane paints the hit through its find bar (so every occurrence is
 * highlighted and the bar explains the count). The phone has no bar open at that
 * moment — the editor is a whole screen, and the row that was tapped is behind it — so
 * the same request becomes the marks PLUS a caret placement, with no query re-seeded.
 *
 * The "fire once per request" rule is the subtle half and it is the reason this is a
 * hook: the resolved target is recomputed on every edit, so keying an effect on the
 * target would drag the caret back to the match after every keystroke.
 */

import { useEffect, useRef } from 'preact/hooks';

import type { CodeSurfaceHandle } from '@/client/components/common/code-surface';
import { useSearchRevealTarget } from '@/client/hooks/editor/use-search-reveal';

interface UseMobileRevealOptions {
  path: string | null;
  content: string;
  ready: boolean;
  surfaceRef: { current: CodeSurfaceHandle | null };
}

export interface MobileReveal {
  matches: readonly { start: number; end: number }[];
  currentIndex: number;
}

export function useMobileReveal({ path, content, ready, surfaceRef }: UseMobileRevealOptions): MobileReveal {
  const target = useSearchRevealTarget(path, content, ready);
  /** The request already served, so a re-render cannot re-fire the jump. */
  const firedRef = useRef<unknown>(null);

  useEffect(() => {
    if (!target || firedRef.current === target.request) return;
    firedRef.current = target.request;
    const match = target.matches[target.currentIndex];
    if (!match) return;
    // No focus: the user is coming from a search row, and stealing focus into the
    // document would pop the soft keyboard over the text they just landed on.
    surfaceRef.current?.select(match.start, match.end, false);
    surfaceRef.current?.revealOffset(match.start);
  }, [target, surfaceRef]);

  return { matches: target?.matches ?? [], currentIndex: target?.currentIndex ?? -1 };
}
