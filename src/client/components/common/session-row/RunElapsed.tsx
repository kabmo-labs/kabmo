/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The elapsed clock in a running session row's timestamp slot: `0s`, `7s`,
 * `1m 23s`, `1h 2m`.
 *
 * Deliberately a LEAF. The one-second tick re-renders this span alone, never
 * the row around it — the same reason openchamber's counter replaced a spinner
 * that repainted a composited layer per row every frame.
 *
 * The start is the server's (`session_stream_state.started_at`, carried on the
 * `sidebar:status` topic), so the count survives a reload, a second tab and a
 * reconnect. A start the tab had to infer would restart at zero on every one of
 * those, which is worse than showing the row's age.
 */

import { useMemo } from 'preact/hooks';
import { useSecondTick } from '@/client/hooks/ui/second-tick';
import { formatFullDate } from '@/shared/lib/workspace/relative-time';
import { formatRunElapsed } from '@/shared/lib/workspace/relative-time';

export interface RunElapsedProps {
  /** Epoch ms the run entered `stream`, from the server's stream row. */
  startedAt: number;
  /** The row's own trailing-column classes; the clock adds only `tabular-nums`. */
  className?: string;
}

export function RunElapsed({ startedAt, className }: RunElapsedProps) {
  const now = useSecondTick();
  // Clock skew between the browser and the server can put the start slightly in
  // the future; `0s` is the honest floor, not a negative count.
  const label = formatRunElapsed(Math.max(0, now - startedAt));
  // The tooltip is a fact about the START, not about the tick: formatting it
  // once keeps `Intl` out of the once-a-second path.
  const started = useMemo(() => formatFullDate(startedAt), [startedAt]);
  return (
    <span
      role="timer"
      className={`tabular-nums ${className ?? ''}`}
      title={started ? `Started ${started}` : undefined}
      aria-label={`Running for ${label}`}
    >
      {label}
    </span>
  );
}
