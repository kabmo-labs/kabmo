/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * One harness update, as a BACKGROUND job.
 *
 * The update used to run inside the POST that asked for it: the request held
 * open for minutes, a reload forgot it, and the five-minute child timeout could
 * kill `npm install -g` halfway through writing the package tree — a corrupt
 * install that the dialog still reported as a failure it could retry. The run is
 * now a detached worker (`update-worker.ts`) that owns its steps and writes this
 * record to disk, so the request can answer immediately, the page can close, and
 * the next open reads what actually happened.
 *
 * Stated once, here, because three places read it: the worker writes it, the
 * route answers it, and the About card polls it.
 */

import type { HarnessUpdateStep } from '@/shared/lib/harness/update-plan';

/** Where one step is in its life. `pending` exists on the record before the
 *  worker reaches it, so a reader sees the whole plan from the first poll. */
export type HarnessUpdateStepState = 'pending' | 'running' | 'ok' | 'failed';

/** A planned step plus what running it produced. */
export interface HarnessUpdateJobStep extends HarnessUpdateStep {
  state: HarnessUpdateStepState;
  /** Exit code, or null while it has not run (or was killed). */
  code: number | null;
}

export interface HarnessUpdateJob {
  harness: string;
  label: string;
  startedAt: number;
  /** Null while running: this is the field that says whether to poll. */
  finishedAt: number | null;
  /** The WORKER process, used to tell a run that is still alive from one that
   *  died without writing its result (a crash, a kill, a reboot). */
  pid: number | null;
  steps: HarnessUpdateJobStep[];
  /** The tail of everything the commands printed. */
  output: string;
  /** Null while running; true/false once the worker has decided. */
  ok: boolean | null;
  /** The sentence the dialog shows. Null while running. */
  message: string | null;
  /** True once the SERVER applied the post-install side effects (forget the
   *  probe and CLI version caches, repoint the launch line). The worker cannot
   *  do those: they read the database, which the server owns. */
  applied: boolean;
  /** The launch command a successful install left behind, when it moved it. */
  repointed: string | null;
}

/** What a step needs to run: the plan, and where the worker reads and writes. */
export interface HarnessUpdateJobSpec {
  harness: string;
  label: string;
  steps: HarnessUpdateStep[];
  statusPath: string;
  lockPath: string;
}
