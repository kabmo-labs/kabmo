/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The bottom jump's LANDING: who owns the viewport, and for how long.
 *
 * Split out of `scroll.ts` so that hook stays under the repo's per-file
 * ceiling; the loop is self-contained and talks to the hook only through refs,
 * which is what lets it run for a couple of seconds without a re-render.
 *
 * A one-shot `scrollTo` is not enough on this timeline, for two reasons that
 * both come from the mounted row window (`row-window.ts`):
 *
 * - The rows a jump passes over mount as it goes, and every measurement
 *   replaces an estimate with a real height — so `scrollHeight` changes DURING
 *   the jump and the target it was issued against is stale. A landing short of
 *   the tail re-reads as "the reader is a few hundred px up", which is exactly
 *   the state the scroll-bottom button exists for: the button stays up, and the
 *   next click finishes the job. That is the reported "it sometimes does not
 *   work until I scroll the rest myself".
 * - A measurement above the viewport moves the tail down, and the row window's
 *   own correction then writes a position under the animation. So while this
 *   watch is armed it is the ONLY writer: the content observer and the row
 *   window both stand down (`jumpActiveRef`), and a competing instant pin is
 *   what made a landing read as a snap instead of one scroll.
 *
 * The guard is released by the LANDING, never by a clock: a timer released it
 * while a long session was still measuring, and the observer then finished the
 * jump with a snap.
 */

import type { RefObject } from 'preact/compat';

/** Frames the viewport must sit at the tail before a jump counts as landed.
 *  Three, not one: the correction that lands a stalled jump produces its own
 *  scroll event, and a single frame of stillness can be the gap between two
 *  layout commits that are still moving the tail. */
const JUMP_SETTLE_FRAMES = 3;

/** Frames without any movement, with the tail still out of reach, that mean
 *  the smooth animation is not running (dropped, or never started). */
const JUMP_STALL_FRAMES = 4;

/** A jump's landing deadline. A layout that never settles must not spin the
 *  watch forever; past this the viewport is released and the content
 *  observer's normal follow pin takes over. */
const JUMP_DEADLINE_MS = 2000;

export interface JumpLandingDeps {
  /** The timeline's scroll container, read at call time. */
  scrollRef: RefObject<HTMLDivElement>;
  /** The guard this watch owns. `true` while a landing is in flight. */
  jumpActiveRef: RefObject<boolean>;
  /** Re-aim at the tail, keeping the animation continuous. */
  pinToBottom: (behavior: ScrollBehavior) => void;
}

export interface JumpLanding {
  /** Take the viewport: releases the guard when the tail is reached. */
  start: () => void;
  /** Abandon the current landing (unmount, or a new jump replacing it). */
  stop: () => void;
}

/** Build the watch. Stable for the life of the hook; a second `start` replaces
 *  the first, so two clicks cannot leave two loops fighting for the viewport. */
export function createJumpLanding({ scrollRef, jumpActiveRef, pinToBottom }: JumpLandingDeps): JumpLanding {
  let frame: number | null = null;
  let deadline = 0;

  const stop = (): void => {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
  };

  const start = (): void => {
    stop();
    deadline = performance.now() + JUMP_DEADLINE_MS;
    let lastTop = -1;
    let still = 0;
    let stalled = 0;
    const step = (): void => {
      frame = null;
      const el = scrollRef.current;
      if (!el || !jumpActiveRef.current) return;
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
      const moved = Math.abs(el.scrollTop - lastTop) > 1;
      lastTop = el.scrollTop;
      if (distance <= 1) {
        stalled = 0;
        still += 1;
        if (still >= JUMP_SETTLE_FRAMES) {
          jumpActiveRef.current = false;
          return;
        }
      } else {
        still = 0;
        stalled = moved ? 0 : stalled + 1;
        // Still for a few frames with the tail out of reach: the animation is
        // not running (a browser drops a smooth programmatic scroll when the
        // content it scrolls through is replaced), or it landed against a
        // target the measurements have since outgrown. Re-aim — smooth, so a
        // continuation never reads as a second, separate jump.
        if (stalled >= JUMP_STALL_FRAMES) {
          stalled = 0;
          pinToBottom('smooth');
        }
      }
      if (performance.now() > deadline) {
        jumpActiveRef.current = false;
        return;
      }
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
  };

  return { start, stop };
}
