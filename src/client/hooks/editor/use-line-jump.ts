/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Serve an outline row's jump in whichever editor holds the buffer.
 *
 * Both editors need the same steps, and they are easy to get subtly wrong one
 * at a time — so they live here once:
 *
 * 1. **Serve each request exactly once.** The request object is the identity; a
 *    re-render must not drag the reader back to a declaration they have since
 *    scrolled away from.
 * 2. **Clear the store only after the jump was APPLIED.** The editor column can
 *    be collapsed while the Files panel is on screen, and there is then no
 *    surface to move — clearing on resolution dropped a request nobody had
 *    served, so reopening the panel lost the click. The request therefore stays
 *    pending until a surface exists; that is why the effect below has no
 *    dependency list, and re-checks on every render.
 * 3. **Leave a rendered preview first.** A markdown/CSV/SVG preview draws no
 *    code surface, so a jump issued while it is open has nothing to move — and
 *    the surface only exists on the NEXT render, when the ref is still null. The
 *    offset is parked and applied once the source is on screen.
 * 4. **Never touch the find bar.** A symbol row names a declaration; a find bar
 *    over it would cover the line it was asked to show. That is the difference
 *    from `useSearchRevealTarget`, and why the two requests are separate stores.
 */

import { useEffect, useRef } from 'preact/hooks';
import type { RefObject } from 'preact';
import type { CodeSurfaceHandle } from '@/client/components/common/code-surface';
import { useLineRevealTarget } from '@/client/hooks/editor/use-line-reveal';
import { setLineReveal } from '@/client/lib/line-reveal';

export interface LineJumpOptions {
  /** The file on screen, as the editor knows it. */
  path: string | null;
  content: string;
  /** The buffer is trustworthy (loaded, and no failed read). */
  ready: boolean;
  surfaceRef: RefObject<CodeSurfaceHandle | null>;
  /** The active document is showing its rendered view rather than its source. */
  isPreview: boolean;
  /** Switch the active document back to its source. */
  exitPreview: () => void;
}

export function useLineJump({ path, content, ready, surfaceRef, isPreview, exitPreview }: LineJumpOptions): void {
  const reveal = useLineRevealTarget(path, content, ready);
  const firedRef = useRef<unknown>(null);
  /** A resolved target waiting for the source surface to mount (a preview was open). */
  const pendingRef = useRef<{ start: number; end: number; offset: number } | null>(null);

  // No dependency list: the two conditions that unblock a jump — the surface
  // mounting, and the preview closing — are not values this hook owns, and a
  // missed render is a click that silently did nothing.
  useEffect(() => {
    if (pendingRef.current !== null) {
      const surface = surfaceRef.current;
      if (isPreview || !surface) return;
      const pending = pendingRef.current;
      pendingRef.current = null;
      apply(surface, pending);
      return;
    }

    if (!reveal || firedRef.current === reveal.request) return;

    if (isPreview) {
      firedRef.current = reveal.request;
      pendingRef.current = { start: reveal.selectionStart, end: reveal.selectionEnd, offset: reveal.offset };
      exitPreview();
      return;
    }

    const surface = surfaceRef.current;
    // No surface: the editor column is collapsed, or this tab draws bytes.
    // The request stays pending, so opening the column serves it.
    if (!surface) return;

    firedRef.current = reveal.request;
    apply(surface, { start: reveal.selectionStart, end: reveal.selectionEnd, offset: reveal.offset });
  });
}

/**
 * Focus the field, place the selection, and scroll to the line.
 *
 * The SELECTION covers the symbol's own name, which is the whole point of the
 * click: a caret at the line's start would sit on `export` for
 * `export class Widget {`. The scroll still targets the LINE's offset, so the
 * reader sees the declaration in context rather than the name alone at the
 * top edge.
 *
 * **`focus: true` is what makes the selection VISIBLE.** A textarea that is
 * not the active element still records `selectionStart`/`selectionEnd`, so the
 * range was always set — and nothing was painted: no selection band, no caret.
 * Measured in the reported symptom (scroll moved, nothing was selected), and a
 * test that only read the range could not see it. `code-editor`'s
 * `setSelection` focuses with `preventScroll` BEFORE writing the range, so the
 * browser cannot scroll the caret into view a second time; the surface's own
 * `revealOffset` remains the only thing that scrolls.
 */
function apply(
  surface: NonNullable<RefObject<CodeSurfaceHandle | null>['current']>,
  target: { start: number; end: number; offset: number },
): void {
  surface.select(target.start, target.end, true);
  surface.revealOffset(target.offset);
  setLineReveal(null);
}
