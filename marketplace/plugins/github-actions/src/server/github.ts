/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * GitHub's Actions API, transcribed into this plugin's shapes.
 *
 * The adapter is a pure transcription: it is handed a way to GET (or POST) and
 * answers `RunRow` / `Job` / `LogTail`. That is what makes the mapping testable
 * against a recorded body with no host, no token and no socket — and it is why
 * this module owns neither the cache, the credential nor the timeout.
 *
 * Two measured facts shape it:
 *
 * - **The list payload is ~16 KB per run** (481 KB for thirty), because every row
 *   embeds the repository object. `perPage` is therefore clamped low and a full
 *   page is reported as truncated rather than claimed complete.
 * - **The job-log endpoint answers `302` to a signed blob URL, and that URL
 *   rejects the GitHub token** (`401 InvalidAuthenticationInfo`). The log read
 *   therefore follows the redirect MANUALLY and re-requests `Location` with no
 *   headers at all.
 */

import type { Job, LogTail, RunRow, RunVerb, Step } from '../protocol';
import { stateOf } from '../state';
import { getJson, authHeaders, type JsonCache } from './http';
import { asRecord, listAt, listOfStrings, num, text, textAt } from './json';
import { cleanLog, tailOf } from './logtext';

export interface GithubContext {
  apiBase: string;
  slug: string;
  host: string;
  token: string | null;
  /** 1-100; the API clamps above 100 and the panel never wants that page. */
  perPage: number;
  cache: JsonCache;
  fetchImpl?: typeof fetch;
}

export type ReadFailure = { ok: false; message: string };

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

function repoUrl(context: GithubContext, path: string): string {
  return joinUrl(context.apiBase, `/repos/${context.slug}${path}`);
}

/** The page size a read asks for, clamped to what the API accepts. */
export function pageSize(perPage: number): number {
  return Math.min(100, Math.max(1, Math.round(perPage)));
}

/** One run row, or null when the payload is not a run. */
export function runOf(raw: unknown): RunRow | null {
  const record = asRecord(raw);
  if (!record) return null;
  const id = num(record.id);
  if (!id) return null;
  const status = text(record.status);
  const conclusion = text(record.conclusion) || null;
  return {
    id,
    name: text(record.name, '(unnamed workflow)'),
    title: text(record.display_title) || text(record.name, '(untitled run)'),
    branch: text(record.head_branch) || null,
    event: text(record.event, 'push'),
    status,
    conclusion,
    state: stateOf(status, conclusion),
    number: num(record.run_number),
    attempt: num(record.run_attempt, 1),
    actor: textAt(record.actor, 'login', 'unknown'),
    createdAt: text(record.created_at),
    startedAt: text(record.run_started_at) || null,
    updatedAt: text(record.updated_at),
    url: text(record.html_url),
  };
}

/** One step, or null when the payload has no name. */
export function stepOf(raw: unknown): Step | null {
  const record = asRecord(raw);
  if (!record) return null;
  const name = text(record.name);
  if (!name) return null;
  const status = text(record.status);
  const conclusion = text(record.conclusion) || null;
  return {
    number: num(record.number),
    name,
    status,
    conclusion,
    state: stateOf(status, conclusion),
    startedAt: text(record.started_at) || null,
    completedAt: text(record.completed_at) || null,
  };
}

/** One job, or null when the payload has no id. */
export function jobOf(raw: unknown): Job | null {
  const record = asRecord(raw);
  if (!record) return null;
  const id = num(record.id);
  if (!id) return null;
  const status = text(record.status);
  const conclusion = text(record.conclusion) || null;
  return {
    id,
    name: text(record.name, '(unnamed job)'),
    status,
    conclusion,
    state: stateOf(status, conclusion),
    startedAt: text(record.started_at) || null,
    completedAt: text(record.completed_at) || null,
    runner: text(record.runner_name) || null,
    labels: listOfStrings(record.labels),
    url: text(record.html_url) || null,
    steps: listAt(record.steps)
      .map(stepOf)
      .filter((step): step is Step => step !== null),
  };
}

export interface RunPageResult {
  ok: true;
  runs: RunRow[];
  total: number | null;
  truncated: boolean;
  notes: string[];
  authenticated: boolean;
}

/** One page of runs for the repository, optionally narrowed. */
export async function listRuns(
  context: GithubContext,
  filter: { branch: string; status: string },
): Promise<RunPageResult | ReadFailure> {
  const params = new URLSearchParams({ per_page: String(pageSize(context.perPage)) });
  if (filter.branch.trim()) params.set('branch', filter.branch.trim());
  if (filter.status.trim()) params.set('status', filter.status.trim());

  const result = await getJson({
    url: `${repoUrl(context, '/actions/runs')}?${params.toString()}`,
    headers: authHeaders(context.token),
    cache: context.cache,
    ...(context.fetchImpl ? { fetchImpl: context.fetchImpl } : {}),
  });
  if (!result.ok) return { ok: false, message: result.message };

  const payload = asRecord(result.value) ?? {};
  const runs = listAt(payload.workflow_runs)
    .map(runOf)
    .filter((run): run is RunRow => run !== null);
  const authenticated = Boolean(context.token);
  const notes: string[] = [];
  if (!authenticated) {
    notes.push('Reading anonymously: runs and jobs are visible, job logs are not.');
  }
  if (runs.length >= pageSize(context.perPage)) {
    notes.push(`Showing ${runs.length} runs; GitHub has more.`);
  }
  return {
    ok: true,
    runs,
    total: typeof payload.total_count === 'number' ? payload.total_count : null,
    truncated: runs.length >= pageSize(context.perPage),
    notes,
    authenticated,
  };
}

/** One run, by id. */
export async function getRun(context: GithubContext, id: number): Promise<{ ok: true; run: RunRow } | ReadFailure> {
  const result = await getJson({
    url: repoUrl(context, `/actions/runs/${id}`),
    headers: authHeaders(context.token),
    cache: context.cache,
    ...(context.fetchImpl ? { fetchImpl: context.fetchImpl } : {}),
  });
  if (!result.ok) return { ok: false, message: result.message };
  const run = runOf(result.value);
  if (!run) return { ok: false, message: 'GitHub answered a run this panel could not read.' };
  return { ok: true, run };
}

/** Every job of a run's latest attempt, with their steps. */
export async function listJobs(
  context: GithubContext,
  id: number,
): Promise<{ ok: true; jobs: Job[]; notes: string[] } | ReadFailure> {
  const params = new URLSearchParams({ per_page: '100', filter: 'latest' });
  const result = await getJson({
    url: `${repoUrl(context, `/actions/runs/${id}/jobs`)}?${params.toString()}`,
    headers: authHeaders(context.token),
    cache: context.cache,
    ...(context.fetchImpl ? { fetchImpl: context.fetchImpl } : {}),
  });
  if (!result.ok) return { ok: false, message: result.message };
  const payload = asRecord(result.value) ?? {};
  const jobs = listAt(payload.jobs)
    .map(jobOf)
    .filter((job): job is Job => job !== null);
  const notes: string[] = [];
  if (jobs.length >= 100) notes.push('More than 100 jobs; the page is full.');
  return { ok: true, jobs, notes };
}

/** The sentence a thrown fetch becomes. Three call sites, one wording. */
function unreachable(cause: unknown): string {
  return `Could not reach GitHub: ${cause instanceof Error ? cause.message : String(cause)}`;
}

/**
 * One job's log, cleaned and tailed.
 *
 * The first request carries the token and MUST NOT follow the redirect; the
 * second carries nothing. `Range` is not honoured on the signed URL (measured:
 * a `bytes=-2000` request answered `200` with all 63,430 bytes), so the tail is
 * taken after the download rather than asked for.
 */
export async function jobLog(
  context: GithubContext,
  jobId: number,
  capBytes: number,
  fetchImpl: typeof fetch = context.fetchImpl ?? fetch,
): Promise<{ ok: true; log: LogTail } | ReadFailure> {
  if (!context.token) {
    return {
      ok: false,
      message: 'Job logs need a token: GitHub answers 403 to an anonymous read.',
    };
  }
  const url = repoUrl(context, `/actions/jobs/${jobId}/logs`);
  let first: Response;
  try {
    first = await fetchImpl(url, {
      headers: { ...authHeaders(context.token), accept: 'application/vnd.github+json' },
      redirect: 'manual',
      signal: AbortSignal.timeout(20_000),
    });
  } catch (cause) {
    return { ok: false, message: unreachable(cause) };
  }
  if (first.status >= 400) {
    const body = await first.json().catch(() => null);
    const message = typeof asRecord(body)?.message === 'string' ? String(asRecord(body)?.message) : `GitHub answered ${first.status}.`;
    return { ok: false, message: `GitHub refused the log: ${message}` };
  }
  const location = first.headers.get('location');
  if (!location) return { ok: false, message: 'GitHub answered the log request without a download URL.' };

  let second: Response;
  try {
    second = await fetchImpl(location);
  } catch (cause) {
    return { ok: false, message: `Could not download the log: ${cause instanceof Error ? cause.message : String(cause)}` };
  }
  if (!second.ok) return { ok: false, message: `The log download answered ${second.status}.` };

  const raw = await second.text();
  const cleaned = cleanLog(raw);
  const { text: tailed, truncated } = tailOf(cleaned, Math.max(1, capBytes));
  return { ok: true, log: { job: String(jobId), text: tailed, bytes: cleaned.length, truncated } };
}

const VERB_PATH: Readonly<Record<RunVerb, string>> = {
  cancel: 'cancel',
  rerun: 'rerun',
  'rerun-failed': 'rerun-failed-jobs',
};

const VERB_DONE: Readonly<Record<RunVerb, string>> = {
  cancel: 'Cancellation requested.',
  rerun: 'Re-run requested.',
  'rerun-failed': 'Re-run of the failed jobs requested.',
};

/** One of the three verbs. A refusal carries GitHub's own sentence. */
export async function act(
  context: GithubContext,
  id: number,
  verb: RunVerb,
): Promise<{ ok: true; message: string } | ReadFailure> {
  if (!context.token) {
    return { ok: false, message: 'This verb needs a token: GitHub refuses it anonymously.' };
  }
  const fetchImpl = context.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(repoUrl(context, `/actions/runs/${id}/${VERB_PATH[verb]}`), {
      method: 'POST',
      headers: { ...authHeaders(context.token), 'content-length': '0' },
      signal: AbortSignal.timeout(20_000),
    });
  } catch (cause) {
    return { ok: false, message: unreachable(cause) };
  }
  if (response.ok) return { ok: true, message: VERB_DONE[verb] };
  const body = await response.json().catch(() => null);
  const stated = asRecord(body)?.message;
  return {
    ok: false,
    message: typeof stated === 'string' ? stated : `GitHub answered ${response.status}.`,
  };
}
