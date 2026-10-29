/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Follow-mode handoff for a jump-rail click.
 *
 * The rail reaches any user turn of a long session, and a turn outside the
 * mounted window is reached by PAGING older windows in (session-pagination).
 * That paging is what makes the jump fight the streaming auto-scroll: each
 * prepended window grows the content ABOVE the viewport, and while
 * `followRef` is true the content observer reads that growth as "the tail
 * moved away" and re-pins to the bottom — so the viewport lands back at the
 * tail instead of on the turn the user clicked.
 *
 * Clearing the flag once at click time is not enough, for two reasons:
 *
 * 1. `handleScroll`'s own re-engage rule is "the viewport is near the tail =
 *    following". A jump that starts pinned at the tail (the normal case — the
 *    user is reading the newest answer) is still near the tail for every
 *    prepend, so the flag flips straight back on the first one.
 * 2. The landing itself takes several frames of correction (see `revealRow`),
 *    and the paging walk before it can take seconds on a long session.
 *
 * So the flag is held off for the WHOLE jump — until the promise the jump
 * returns settles, which is only after the landing has settled — and then for
 * a few still frames, the same settle test `releaseJumpGuard` uses. The
 * release is deliberate: a jump to the NEWEST turn lands at the tail, where
 * re-engaging is correct, and `handleScroll` does exactly that on the next
 * scroll event. Without the release, jumping to the last turn would silently
 * stop following the stream.
 *
 * Measured on a 760-message session (1440x900, Chromium): before this, a jump
 * to turn #1 of 21 landed at the tail (`scrollTop` 165560 = max) instead of on
 * the target; after, every turn of the rail lands in view. A hold that ended
 * on a frame count alone was not enough either — the paging walk sat still at
 * the tail for more than six frames while a window was in flight, so the hold
 * expired mid-jump and the prepend re-pinned the tail (reproduced: a jump to
 * turn #60 of 120 ended at `scrollTop` max).
 */

import { useCallback } from 'preact/hooks';

/** Still frames that mean "the jump's scroll has settled". Mirrors
 *  `releaseJumpGuard` in session-pagination.ts. */
const SETTLE_FRAMES = 6;

/** Frame ceiling on the hold. A guard, not a budget: a jump settles well inside
 *  it, and a pathological animation that never does must not spin a rAF loop
 *  forever (the same reason the paging walk is request-bounded). The jump's own
 *  promise is bounded too — `JUMP_MAX_REQUESTS` windows, then the reveal's
 *  deadline — so this is the backstop, not the timer. */
const MAX_HOLD_FRAMES = 600;

export interface RailJumpRefs {
  /** Scroll hook's follow flag. `true` = pinned to the tail. */
  followRef: { current: boolean | null };
  /** The timeline's scroll container. */
  scrollRef: { current: HTMLDivElement | null };
}

/**
 * Wrap the paging jump so follow mode stays off until it has landed. Returns
 * the callback the rail's `onJumpTurn` should call.
 */
export function useRailJump(
  jumpToTurn: (id: string, index: number) => Promise<boolean>,
  { followRef, scrollRef }: RailJumpRefs,
): (id: string, index: number) => Promise<boolean> {
  return useCallback((id: string, index: number): Promise<boolean> => {
    followRef.current = false;
    let inFlight = true;
    let lastTop = scrollRef.current?.scrollTop ?? 0;
    let settledFrames = 0;
    let frames = 0;
    const hold = () => {
      const el = scrollRef.current;
      // Re-assert before the settle test: the scroll handler may have flipped
      // the flag back on the prepend that just landed.
      followRef.current = false;
      if (!el) return;
      if (!inFlight) {
        if (el.scrollTop === lastTop) settledFrames += 1;
        else {
          settledFrames = 0;
          lastTop = el.scrollTop;
        }
        if (settledFrames >= SETTLE_FRAMES) return;
      }
      if ((frames += 1) > MAX_HOLD_FRAMES) return;
      requestAnimationFrame(hold);
    };
    requestAnimationFrame(hold);
    const result = jumpToTurn(id, index);
    // The jump's promise settles only once its landing has settled (the reveal
    // awaits its own correction window), so this is the signal the hold waits
    // for — never a fixed duration.
    void result.then(
      () => { inFlight = false; },
      () => { inFlight = false; },
    );
    return result;
  }, [jumpToTurn, followRef, scrollRef]);
}
