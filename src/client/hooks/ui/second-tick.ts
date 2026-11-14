/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * ONE one-second clock for every live elapsed readout, shared by the whole page.
 *
 * The sidebar can show a dozen running sessions at once, and each row's clock
 * has to move. A `setInterval` per row would mean N timers drifting apart and N
 * places to clear on unmount; this module keeps a single interval alive only
 * while something is subscribed.
 *
 * Consumers read the wall clock, not a tick counter: the value they count from
 * is an absolute start (the server's `runStartedAt`), so a timer that was
 * throttled in a background tab still reports the true elapsed time the moment
 * it runs again. Nothing here needs to compensate for a missed second.
 */

import { useEffect, useState } from 'preact/hooks';

const TICK_MS = 1000;

const subscribers = new Set<(now: number) => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function tick(): void {
  const now = Date.now();
  for (const notify of subscribers) notify(now);
}

function subscribe(notify: (now: number) => void): () => void {
  subscribers.add(notify);
  if (timer === null) timer = setInterval(tick, TICK_MS);
  return () => {
    subscribers.delete(notify);
    if (subscribers.size === 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
}

/**
 * Wall-clock time, refreshed once a second while `active`. Mount the consumer
 * in a LEAF so the tick re-renders the readout, never the row around it.
 */
export function useSecondTick(active = true): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    return subscribe(setNow);
  }, [active]);
  return now;
}
