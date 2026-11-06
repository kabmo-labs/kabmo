/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * What a `wait` result says when it returned with nothing new.
 *
 * omp 18.17.0 removed the 30-minute cap (`WAIT_MAX_MS`) and with it the "Wait
 * limit reached" answer the `wait` card used to name. A blocking wait now
 * returns when its window elapses, and the window climbs one rung for every
 * back-to-back idle wait — 5 s, 10 s, 30 s, 60 s, then 5 minutes — restarting at
 * the floor once the agent has done other work in between. So there is no
 * ceiling to count down to any more.
 *
 * Neither the rung nor the streak is a field on the result: both are stated in
 * omp's prose, which is what this module parses. It lives beside `wait.ts`
 * rather than inside it because the card's parser (jobs, agents, messages) and
 * the outcomes omp words are separate subjects, and the file ceiling is real.
 */

import { formatToolMs } from '@/shared/lib/chat/tool/labels';

/**
 * How long a blocking `wait` gives its first wake, per rung of omp's ladder.
 */
export const WAIT_LADDER_MS = [5_000, 10_000, 30_000, 60_000, 300_000] as const;

/** A span in omp's `formatDuration` spelling: `250ms`, `5.0s`, `30s`, `1m45s`, `5m`, `2h5m`. */
const OMP_DURATION = String.raw`(?:\d+d)?(?:\d+h)?(?:\d+m)?(?:[\d.]+s)?(?:\d+ms)?`;

/** `No reply within 5.0s.` / `No service finished within 30s. Read proc:// for status.` */
const WAIT_WINDOW_TEXT = new RegExp(`^No (?:reply|service finished) within (${OMP_DURATION})\\.`, 'm');

/** `Nothing new after 15.0s of back-to-back waits.` — appended from the SECOND
 *  consecutive idle wait, inside a `<system-notice>` block, and the only place
 *  the running streak is stated. */
const WAIT_IDLE_NOTICE = new RegExp(
  `^(?:<system-notice>\\s*)?Nothing new after (${OMP_DURATION}) of back-to-back waits\\b`,
  'm',
);

/** What one idle return says, read from omp's prose — the result carries no field
 *  for it. `windowMs` is the rung this call ran; `streakMs` the total across the
 *  consecutive idle waits that led to it. */
export interface WaitIdle {
  windowMs?: number;
  streakMs?: number;
}

/**
 * The idle return this result reports, or undefined when the wait settled
 * something.
 *
 * Text is the only signal: `{op:'wait', jobs:[]}` is what an idle return, a
 * service wake and a reply that can never arrive all answer with. omp names the
 * window in its own sentence from the FIRST rung, and from the second on it
 * appends the notice that tells the model waiting is not progress — whose span
 * is the running total, so it is read first.
 */
export function waitIdleOf(output: string | undefined): WaitIdle | undefined {
  const text = output ?? '';
  const notice = WAIT_IDLE_NOTICE.exec(text);
  if (notice) return { streakMs: parseOmpDuration(notice[1] ?? '') };
  const window = WAIT_WINDOW_TEXT.exec(text);
  if (window) return { windowMs: parseOmpDuration(window[1] ?? '') };
  return undefined;
}

/** `idle 10s` for the rung a call ran, `idle 15s total` once omp names the streak. */
export function waitIdleLabel(idle: WaitIdle): string {
  if (idle.streakMs !== undefined) return `idle ${formatToolMs(idle.streakMs)} total`;
  if (idle.windowMs !== undefined) return `idle ${formatToolMs(idle.windowMs)}`;
  return 'idle';
}

/**
 * omp's `formatDuration` (`@oh-my-pi/pi-utils`): `250ms`, `4.5s`, `1m30s`,
 * `1m`, `2h5m`. Parsed back because the notice states the window as prose.
 */
function parseOmpDuration(text: string): number | undefined {
  const trimmed = text.trim();
  const match = /^(?:(\d+)d)?(?:(\d+)h)?(?:(\d+)m)?(?:([\d.]+)s)?(?:(\d+)ms)?$/.exec(trimmed);
  if (!match || !trimmed) return undefined;
  const [, days, hours, minutes, seconds, millis] = match;
  const total =
    Number(days ?? 0) * 86_400_000 +
    Number(hours ?? 0) * 3_600_000 +
    Number(minutes ?? 0) * 60_000 +
    Number(seconds ?? 0) * 1000 +
    Number(millis ?? 0);
  return Number.isFinite(total) && total > 0 ? total : undefined;
}
