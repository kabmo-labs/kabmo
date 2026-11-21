/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The wire shapes both halves share.
 *
 * Nothing here names a GitHub field: a `Workflow Run` becomes a `RunRow` at the
 * adapter's edge so the panel never re-derives a status from a raw response, and
 * the server never sends one. `note` strings are sentences a reader can act on,
 * which is why they travel rather than a code the panel would have to translate.
 */

/** The RPC methods the app half calls. One place, so a typo is a compile error. */
export const RPC = {
  list: 'list',
  run: 'run',
  log: 'log',
  act: 'act',
  watch: 'watch',
  unwatch: 'unwatch',
} as const;

/** The four states a badge can be, after every host word is mapped. */
export type RunState = 'success' | 'failure' | 'pending' | 'neutral';

/** One workflow run, as the list draws it. */
export interface RunRow {
  id: number;
  /** The workflow's name, e.g. `Release`. */
  name: string;
  /** What this run was for: the commit subject or the event's title. */
  title: string;
  branch: string | null;
  event: string;
  /** GitHub's own word: `queued`, `in_progress`, `completed`, … */
  status: string;
  /** GitHub's own word: `success`, `failure`, … — null while in flight. */
  conclusion: string | null;
  state: RunState;
  number: number;
  attempt: number;
  actor: string;
  createdAt: string;
  startedAt: string | null;
  updatedAt: string;
  url: string;
}

/** One page of runs, plus the sentences the panel must say out loud. */
export interface RunPage {
  slug: string;
  host: string;
  authenticated: boolean;
  branch: string;
  status: string;
  runs: RunRow[];
  total: number | null;
  /** The host returned a full page, so there may be more than these. */
  truncated: boolean;
  notes: string[];
}

/** One step of a job. */
export interface Step {
  number: number;
  name: string;
  status: string;
  conclusion: string | null;
  state: RunState;
  startedAt: string | null;
  completedAt: string | null;
}

/** One job of a run. */
export interface Job {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  state: RunState;
  startedAt: string | null;
  completedAt: string | null;
  runner: string | null;
  labels: string[];
  url: string | null;
  steps: Step[];
}

/**
 * Progress, computed from jobs and steps.
 *
 * There is no percentage in the API, so this is the honest denominator: jobs
 * finished out of jobs known, and — for the one job in flight — its step count.
 */
export interface RunProgress {
  done: number;
  total: number;
  failing: number;
  running: string | null;
  runningStep: string | null;
}

export interface RunDetail {
  run: RunRow;
  jobs: Job[];
  progress: RunProgress;
  notes: string[];
}

export interface LogTail {
  job: string;
  text: string;
  /** The bytes the host sent, before the tail was cut. */
  bytes: number;
  truncated: boolean;
}

export type RunVerb = 'cancel' | 'rerun' | 'rerun-failed';

export interface ActResult {
  message: string;
}

/** One repository's latest read, as the header readout and the panel see it. */
export interface Snapshot {
  at: string;
  runs: RunRow[];
  failing: number;
  running: number;
}

/** The plugin's one realtime topic: a snapshot per watched repository. */
export interface Snapshots {
  entries: Record<string, Snapshot>;
}

/** What a read is narrowed to. Empty strings mean "not narrowed". */
export interface RunFilter {
  branch: string;
  status: string;
}

/** The key a snapshot is stored under on both sides of the wire. */
export function repoKey(root: string, repo: string): string {
  return `${root}\u0000${repo}`;
}

/** What the panel asks the server for. */
export interface ListInput {
  root: string;
  repo: string;
  filter: RunFilter;
}

export interface RunInput {
  root: string;
  repo: string;
  id: number;
}

export interface LogInput {
  root: string;
  repo: string;
  jobId: number;
  /** Bytes to keep from the end. Absent means the configured tail. */
  tail?: number;
}

export interface ActInput {
  root: string;
  repo: string;
  id: number;
  verb: RunVerb;
}
