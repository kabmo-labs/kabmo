/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Four hosts, four CI vocabularies, one badge.
 *
 * The mapping is a table rather than a chain of `if`s because the values are
 * enumerable and each host keeps adding to them: GitHub's checks report
 * `success|failure|neutral|skipped|cancelled|timed_out|action_required`, a
 * commit status reports `success|failure|pending|error`, GitLab pipelines report
 * `success|failed|running|pending|canceled|skipped|manual|created|waiting_for_resource`,
 * Gitea reports `success|failure|pending|error|warning`, and Bitbucket reports
 * `SUCCESSFUL|FAILED|INPROGRESS|STOPPED`.
 *
 * **A word nobody recognizes is `neutral`, never `failure`.** A host that adds a
 * state must not paint a red badge over a change that may be fine — and it must
 * not paint green either. `neutral` is the honest third answer, and the tooltip
 * carries the host's own word so the reader can see what it actually said.
 *
 * The roll-up is `worst wins`: one failing job in twenty is a failing pipeline,
 * because that is what blocks a merge.
 */

import type { ForgeCi, ForgeCiState } from '../protocol';

/** Every word seen in the wild, mapped. Unknown words fall to `neutral`. */
const WORDS: Readonly<Record<string, ForgeCiState>> = {
  // GitHub checks and commit statuses.
  success: 'success',
  neutral: 'neutral',
  skipped: 'neutral',
  cancelled: 'neutral',
  failure: 'failure',
  timed_out: 'failure',
  action_required: 'failure',
  error: 'failure',
  pending: 'pending',
  queued: 'pending',
  in_progress: 'pending',
  waiting: 'pending',
  // GitLab pipelines.
  failed: 'failure',
  running: 'pending',
  created: 'pending',
  manual: 'pending',
  waiting_for_resource: 'pending',
  preparing: 'pending',
  scheduled: 'pending',
  canceled: 'neutral',
  // Gitea.
  warning: 'neutral',
  // Bitbucket.
  successful: 'success',
  inprogress: 'pending',
  stopped: 'neutral',
};

/** The normalized state for one host word. */
export function ciStateOf(word: string | null | undefined): ForgeCiState {
  return WORDS[(word ?? '').trim().toLowerCase()] ?? 'neutral';
}

/** Rank for a roll-up: a worse verdict wins. */
const RANK: Record<ForgeCiState, number> = { success: 0, neutral: 1, pending: 2, failure: 3 };

/** The worst of the given states, or null when there are none. */
export function worstCi(states: readonly ForgeCiState[]): ForgeCiState | null {
  if (states.length === 0) return null;
  return states.reduce((worst, state) => (RANK[state] > RANK[worst] ? state : worst), states[0]);
}

/**
 * One badge from a list of host states.
 *
 * `url` is the page a reader would open to see the run, which is why it is
 * carried rather than derived: each host puts it somewhere different (a check
 * run's `html_url`, a pipeline's `web_url`).
 */
export function ciBadge(words: readonly (string | null | undefined)[], url: string | null): ForgeCi | null {
  const present = words.filter((word): word is string => typeof word === 'string' && word.trim() !== '');
  if (present.length === 0) return null;
  const state = worstCi(present.map(ciStateOf));
  if (!state) return null;
  // The label names what the host said, and the count when there are several:
  // `success` for one run, `5 checks` when it is a roll-up.
  const label = present.length === 1 ? present[0] : `${present.length} checks`;
  return { state, label, url };
}

/**
 * A GitHub check-runs payload rolled up.
 *
 * `status: queued|in_progress` counts as pending even when a `conclusion` is
 * absent, which is the shape a run in flight has — reading only `conclusion`
 * would call an unfinished run `neutral` and paint a grey badge over a job that
 * has not started.
 */
export function githubChecks(payload: unknown, url: string | null): ForgeCi | null {
  const runs = Array.isArray((payload as { check_runs?: unknown })?.check_runs)
    ? ((payload as { check_runs: unknown[] }).check_runs as Array<Record<string, unknown>>)
    : [];
  if (runs.length === 0) return null;
  const words = runs.map((run) => {
    const conclusion = typeof run.conclusion === 'string' ? run.conclusion : '';
    if (conclusion) return conclusion;
    return typeof run.status === 'string' ? run.status : '';
  });
  return ciBadge(words, url);
}

/** A GitHub combined-status payload rolled up, for a commit with no checks. */
export function githubStatus(payload: unknown, url: string | null): ForgeCi | null {
  const state = (payload as { state?: unknown })?.state;
  if (typeof state !== 'string' || !state) return null;
  return ciBadge([state], url);
}
