/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * GitHub's vocabulary, mapped once, for both halves.
 *
 * A run, a job and a step all spell their progress as `status` plus
 * `conclusion`, and a reader only ever needs four answers from them: passing,
 * failing, still running, or something this panel cannot judge. The mapping is a
 * table rather than a chain of `if`s because the word lists are enumerable and
 * the host keeps adding to them.
 *
 * **A word nobody recognizes is `neutral`, never `failure`, and never
 * `success`.** A new conclusion painted red over a run that may be fine is a
 * false alarm; painted green it hides a real failure. `neutral` is the honest
 * third answer, and the panel shows GitHub's own word beside it.
 */

import type { RunState } from './protocol';

const WORDS: Readonly<Record<string, RunState>> = {
  success: 'success',
  neutral: 'neutral',
  skipped: 'neutral',
  cancelled: 'neutral',
  canceled: 'neutral',
  stale: 'neutral',
  failure: 'failure',
  timed_out: 'failure',
  action_required: 'failure',
  startup_failure: 'failure',
  error: 'failure',
  // Anything not finished is pending, whether the host says it with a status
  // (`queued`, `in_progress`) or with a conclusion-shaped word (`pending`).
  queued: 'pending',
  in_progress: 'pending',
  waiting: 'pending',
  requested: 'pending',
  pending: 'pending',
  completed: 'neutral',
};

/** The state one run/job/step is in, from its two host fields. */
export function stateOf(status: string | null | undefined, conclusion: string | null | undefined): RunState {
  const settled = (conclusion ?? '').trim().toLowerCase();
  if (settled) return WORDS[settled] ?? 'neutral';
  const live = (status ?? '').trim().toLowerCase();
  if (!live) return 'neutral';
  // A run in flight has no conclusion, and reading the empty conclusion as
  // `neutral` would paint a grey badge over a job that has not started.
  return WORDS[live] ?? 'neutral';
}

/** How bad a state is, for a roll-up. */
const RANK: Readonly<Record<RunState, number>> = { success: 0, neutral: 1, pending: 2, failure: 3 };

/** The worst of the given states, or null when there are none. */
export function worstState(states: readonly RunState[]): RunState | null {
  if (states.length === 0) return null;
  return states.reduce((worst, state) => (RANK[state] > RANK[worst] ? state : worst), states[0]!);
}
