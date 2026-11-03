/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Rate gate for screencast frames: at most one frame per interval, and the
 * newest frame inside a window is DELIVERED, never dropped.
 *
 * This is what replaces `everyNthFrame: 2` at the protocol level. Chromium
 * counts the frames a page produces in a burst and discards the odd ones, so
 * nudging it to 2 turned "the page painted once" into "nothing was ever sent"
 * (measured; see `frame-params.ts`). Deferring here cannot swallow a lone
 * paint: it is always the pending frame that goes out when the window closes.
 */

import type { BrowserViewFrame } from '@/shared/types';

export interface FrameGate {
  /** Offer a frame; it is emitted now or replaces the one waiting. */
  push: (frame: BrowserViewFrame) => void;
  /** Drop anything waiting and forget the clock (a new tab starts fresh). */
  reset: () => void;
}

export function createFrameGate(emit: (frame: BrowserViewFrame) => void, minIntervalMs: number): FrameGate {
  /** Null, not 0: a fake clock parked at the epoch would read `0 - 0` as "too soon". */
  let lastEmitAt: number | null = null;
  let pending: BrowserViewFrame | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clearTimer = (): void => {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
  };

  const deliver = (frame: BrowserViewFrame): void => {
    pending = null;
    clearTimer();
    lastEmitAt = Date.now();
    emit(frame);
  };

  const schedule = (delayMs: number): void => {
    clearTimer();
    timer = setTimeout(() => {
      timer = null;
      if (pending) deliver(pending);
    }, delayMs);
  };

  return {
    push: (frame) => {
      const sinceLast = lastEmitAt === null ? Number.POSITIVE_INFINITY : Date.now() - lastEmitAt;
      if (sinceLast >= minIntervalMs && !timer) {
        deliver(frame);
        return;
      }
      pending = frame;
      if (!timer) schedule(Math.max(0, minIntervalMs - sinceLast));
    },
    reset: () => {
      pending = null;
      clearTimer();
      lastEmitAt = null;
    },
  };
}
