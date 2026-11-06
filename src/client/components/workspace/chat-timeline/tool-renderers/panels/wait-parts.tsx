/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The two pieces of the `wait` card that are not the card: its stopwatch and its
 * progress track.
 *
 * Split out of `Wait.tsx` for the repo's per-file ceiling; the rule each one
 * carries is documented on the piece itself.
 */

import { useEffect, useState } from 'preact/hooks';

/**
 * The stopwatch for a wait that is still blocking.
 *
 * Two sources, in order of honesty:
 *   - the call's own START clock (`startedAt`) — an absolute time, so the ticker
 *     only has to force a re-render and the value can never drift;
 *   - a relative base (a finished call's measured span, or a job's age as a last
 *     resort), which the ticker advances while the call is still running.
 *
 * A watched job's `durationMs` is deliberately NOT the clock: a job routinely
 * starts before the wait that watches it (measured on a real result — `bg_8`
 * had run 126 s while the `wait` call took 20 s).
 */
export function useStopwatch(startedAt: number | undefined, baseMs: number | undefined, running: boolean): number | undefined {
  const [now, setNow] = useState(() => Date.now());
  const [anchor, setAnchor] = useState(() => Date.now());
  const live = running && (startedAt !== undefined || baseMs !== undefined);

  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [live]);

  // A new relative base is a new measurement; the ticker counts from it, never
  // from mount, or the same seconds would be counted twice.
  useEffect(() => {
    if (baseMs === undefined) return;
    setAnchor(Date.now());
    setNow(Date.now());
  }, [baseMs]);

  if (running && startedAt !== undefined) return Math.max(0, now - startedAt);
  if (baseMs === undefined) return undefined;
  return running ? baseMs + Math.max(0, now - anchor) : baseMs;
}

/** A progress track. `percent` null means "no number to show" — the band sweeps
 *  instead of pretending to be half done. */
export function ProgressTrack({ percent, active }: { percent: number | null; active: boolean }) {
  const clamped = percent === null ? null : Math.max(0, Math.min(100, percent));
  return (
    <div
      className="relative h-1.5 overflow-hidden rounded-full bg-ink/8"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={clamped ?? undefined}
      aria-label={clamped === null ? 'Waiting' : 'Wait progress'}
    >
      {clamped === null ? (
        active && <span className="wait-bar-sweep absolute inset-y-0 w-1/3 rounded-full bg-ink/45" />
      ) : (
        <span
          className={`absolute inset-y-0 left-0 rounded-full ${active ? 'bg-ink/60' : 'bg-success/70'}`}
          style={{ width: `${clamped}%` }}
        />
      )}
    </div>
  );
}
