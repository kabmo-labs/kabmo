/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The queue behind "update two harnesses": read every record, apply what a
 * finished run left behind, and start the next WAITING one.
 *
 * **Why a queue and not two installs at once.** The press used to be refused
 * while any run was in flight, which made "update these two" impossible: the
 * second press got a `409` and the user had to come back later. Two installs
 * really cannot overlap — they share the global npm prefix, and two
 * `npm install -g` over it is the way an npm tree is corrupted — so the second
 * press is now ACCEPTED and its record carries `queuedAt`. This module starts it
 * when the install ahead of it settles, and the row says it is waiting.
 *
 * **The queue is driven by a clock, not by the dialog.** A queued run must not
 * depend on a browser tab staying open: the About card can be closed, the page
 * reloaded, and the worker still has to start. The ticker reads the same records
 * the worker writes, so it also settles a run that died without reporting, and
 * applies the post-install side effects (`forgetProbe`, the launch-line repoint)
 * that a detached process cannot — it does not own the database.
 *
 * **Every write goes through one chain.** Two presses, a queue tick and a status
 * poll can each read-decide-write the records; serialized, the second press sees
 * the first's record and waits instead of racing it into a second worker.
 */

import { probeWithConfig } from '@/server/lib/harness/auto-probe.server';
import { forgetProbe, rememberProbe } from '@/server/lib/harness/probe-cache.server';
import { forgetCliVersion } from '@/server/lib/harness/update-state.server';
import { loadHarnessConfig, saveHarnessConfig } from '@/server/lib/harness/config.server';
import { invalidateOmpCliCache } from '@/server/lib/omp/core/cli';
import { getHarnessUpdateStatusPath } from '@/server/lib/lifecycle/paths';
import { readUpdateJob, settleDeadJob, writeUpdateJob } from '@/server/lib/harness/update-job-store';
import { spawnUpdateWorker } from '@/server/lib/harness/update-spawn.server';
import { HARNESS_IDS, isBuiltinHarness, type HarnessId } from '@/shared/lib/harness/catalog';
import { harnessUpdateFacts, type HarnessUpdateFacts } from '@/shared/lib/harness/updates';
import { repointAdapterLaunch, type HarnessUpdateStep } from '@/shared/lib/harness/update-plan';
import { jobMoving, jobQueued, jobRunning } from '@/shared/lib/harness/update-job';
import type { HarnessProbe } from '@/server/lib/harness/capabilities';
import type { HarnessUpdateJob } from '@/shared/types/harness-update';

declare global {
  // eslint-disable-next-line no-var
  var __kabmoHarnessUpdateQueueTimer: ReturnType<typeof setInterval> | undefined;
}

/** How often a waiting run is looked at while anything is unfinished. 2 s is
 *  below the dialog's own poll, and the tick is a handful of small file reads. */
export const HARNESS_UPDATE_QUEUE_TICK_MS = 2_000;

/**
 * Run `work` after every earlier read-decide-write over the update records.
 *
 * The records are files, so no lock is held between the read and the write; this
 * chain is what makes "is anything running?" and "start this one" one decision
 * inside a single process. Across processes the worker's own `flock` is still
 * the guard (see `update-worker.ts`).
 */
let chain: Promise<unknown> = Promise.resolve();

export function serializeUpdateWork<T>(work: () => Promise<T>): Promise<T> {
  const next = chain.then(work, work);
  chain = next.then(() => undefined, () => undefined);
  return next;
}

/** Every harness's record, with a run that died without reporting settled. */
export async function readAllUpdateJobs(): Promise<HarnessUpdateJob[]> {
  const jobs = await Promise.all(HARNESS_IDS.map(async (id) => {
    const path = getHarnessUpdateStatusPath(id);
    return settleDeadJob(await readUpdateJob(path), path);
  }));
  return jobs.filter((job): job is HarnessUpdateJob => job !== null);
}

/**
 * Make an adapter install the one the next spawn runs.
 *
 * The launch table starts an npm adapter through a PINNED `npx -y pkg@x.y.z`,
 * while the update installs the package GLOBALLY. Those are two different
 * resolvers: `npm i -g` writes a binary onto PATH that `npx` never consults, so
 * the press reported success while every new session still started the old
 * pinned build. A user's own configured command is never replaced.
 */
async function pointAtInstalledAdapter(
  harness: HarnessId,
  facts: HarnessUpdateFacts,
  steps: HarnessUpdateStep[],
): Promise<string | null> {
  const config = await loadHarnessConfig(harness);
  const bin = repointAdapterLaunch(
    facts,
    steps,
    config.command,
    facts.agentBin ? Boolean(Bun.which(facts.agentBin)) : false,
  );
  if (!bin) return null;
  await saveHarnessConfig(harness, { ...config, command: bin });
  return bin;
}

/**
 * What a queue pass may run on the side, for the suite that cannot spawn an
 * agent: the real probe by default, a stub in the tests (the seam
 * `runAutoProbe` already offers for the boot pass).
 */
export interface HarnessQueueOptions {
  probe?: (id: HarnessId, cwd: string) => Promise<HarnessProbe>;
}

/**
 * The probes this process is running, keyed by run.
 *
 * A probe spawns an agent and is not awaited by the queue, so the ticker would
 * otherwise start a second one on every pass (and a re-kicked record after a
 * restart would stack on the first).
 */
const probing = new Set<string>();

/**
 * Probe the freshly installed agent and write the answer's arrival onto the
 * record.
 *
 * **The update is not finished with the user until this answers.** `forgetProbe`
 * only drops the stale number; without a new probe the row keeps quoting the
 * version the install just replaced, and the reader has to open Settings and
 * press Check status themselves. The probe is NOT awaited by the install's own
 * report — it spawns an agent process that may take a minute — so the record
 * carries `probe: 'pending'` and a polling dialog re-reads the rows when it
 * turns `done`.
 */
async function probeAfterUpdate(
  harness: HarnessId,
  startedAt: number,
  probe: (id: HarnessId, cwd: string) => Promise<HarnessProbe>,
): Promise<void> {
  let version: string | null = null;
  try {
    const recorded = await probe(harness, process.cwd());
    version = recorded.capabilities.agentVersion ?? null;
    await rememberProbe(harness, recorded);
  } catch (cause) {
    // A probe that fails is a fact the row can live with (it reads "not probed"
    // with the reason'); leaving the record `pending` forever is not.
    console.error(`[harness-update] probe after updating ${harness} failed:`, cause);
  }
  const path = getHarnessUpdateStatusPath(harness);
  // The read and the write are one step against the queue's own passes: a
  // dismissal deletes the record, and a write landing after that delete would
  // resurrect the message the reader just dismissed.
  await serializeUpdateWork(async () => {
    const current = await readUpdateJob(path);
    // A NEW run for the same harness may have replaced the record while this
    // probe ran; writing here would revert that run to the previous one.
    if (!current || current.startedAt !== startedAt) return;
    // The version is stated only when the agent itself answered it: a claim about
    // a number nobody read is the fabrication this whole record exists to avoid.
    const message = version && current.message && !current.message.includes(version)
      ? `${current.message} — it now reports ${version}`
      : current.message;
    await writeUpdateJob({ ...current, probe: 'done', message }, path);
  });
}

/** Run the probe for a settled record, once per run, in the background. */
function startProbe(job: HarnessUpdateJob, options: HarnessQueueOptions): void {
  if (!isBuiltinHarness(job.harness)) return;
  const key = `${job.harness}:${job.startedAt}`;
  if (probing.has(key)) return;
  probing.add(key);
  void probeAfterUpdate(job.harness as HarnessId, job.startedAt, options.probe ?? probeWithConfig)
    .finally(() => probing.delete(key));
}

/** Apply a finished run's post-install side effects exactly once. */
async function applyFinishedJob(
  job: HarnessUpdateJob,
  options: HarnessQueueOptions,
): Promise<HarnessUpdateJob> {
  // The record is a file, so its id is not proof of a catalog entry; an unknown
  // one has no facts and nothing to repoint — it is still marked applied, so it
  // is not re-applied on every tick.
  const harness = isBuiltinHarness(job.harness) ? job.harness : null;
  const facts = harness ? harnessUpdateFacts(harness) : null;
  let repointed: string | null = null;

  if (job.ok && harness) {
    // The cached probe describes the binary that WAS installed, and the CLI's
    // `--version` read is cached for ten minutes: keeping either would report the
    // pre-update number until its TTL ran out.
    await forgetProbe(harness);
    if (facts?.cli) forgetCliVersion(facts.cli.bin);
    // `omp update` can replace its own launcher, so a cached path may be gone.
    if (harness === 'omp-acp') invalidateOmpCliCache();
    if (facts) repointed = await pointAtInstalledAdapter(harness, facts, job.steps);
  }

  // The probe starts only for a run that actually moved something: a failed
  // install has no new binary to ask, and an `own` harness is never updated here.
  const willProbe = Boolean(job.ok && harness);
  const settled: HarnessUpdateJob = {
    ...job,
    applied: true,
    probe: willProbe ? 'pending' : job.probe ?? null,
    repointed,
    message: job.ok && job.message
      ? `${job.message}${repointed ? ` — launches now run \`${repointed}\`` : ''}`
      : job.message,
  };
  await writeUpdateJob(settled, getHarnessUpdateStatusPath(job.harness));
  if (willProbe) startProbe(settled, options);
  return settled;
}

/**
 * The oldest WAITING record, or null.
 *
 * One install at a time, so the records form a queue and the OLDEST press is the
 * next one — not the newest, which would let a later press jump ahead of the one
 * the user made first.
 */
export function nextQueuedJob(jobs: HarnessUpdateJob[]): HarnessUpdateJob | null {
  const waiting = jobs.filter(jobQueued);
  if (waiting.length === 0) return null;
  return waiting.sort((a, b) => (a.queuedAt ?? 0) - (b.queuedAt ?? 0))[0];
}

/** Keep the ticker alive while anything is moving, and stop it when nothing is. */
function syncTicker(jobs: HarnessUpdateJob[]): void {
  if (jobs.some(jobMoving)) {
    globalThis.__kabmoHarnessUpdateQueueTimer ??= setInterval(() => {
      void pumpUpdateQueue().catch((cause) => {
        console.error('[harness-update] queue tick failed:', cause);
      });
    }, HARNESS_UPDATE_QUEUE_TICK_MS);
    // A background queue must not be the reason the process will not exit.
    globalThis.__kabmoHarnessUpdateQueueTimer.unref?.();
    return;
  }
  if (globalThis.__kabmoHarnessUpdateQueueTimer) {
    clearInterval(globalThis.__kabmoHarnessUpdateQueueTimer);
    globalThis.__kabmoHarnessUpdateQueueTimer = undefined;
  }
}

/**
 * One pass: settle dead runs, apply finished ones, start the next waiting run.
 *
 * Returns the records as this pass left them, so the status route answers from
 * the same read it acted on. Called by the status route, by the ticker while
 * anything is unfinished, and once after the listener is up (a queued run
 * accepted before a restart must not wait for a browser).
 */
export function pumpUpdateQueue(options: HarnessQueueOptions = {}): Promise<HarnessUpdateJob[]> {
  return serializeUpdateWork(async () => {
    let jobs = await readAllUpdateJobs();

    const finished = await Promise.all(
      jobs.map((job) => job.finishedAt !== null && !job.applied ? applyFinishedJob(job, options) : job),
    );
    jobs = finished;

    // A probe whose server went away mid-flight leaves `pending` behind; the
    // next pass (a poll, or the boot pump) runs it again rather than leaving the
    // row on the old number forever.
    for (const job of jobs) {
      if (job.finishedAt !== null && job.probe === 'pending') startProbe(job, options);
    }

    const waiting = nextQueuedJob(jobs);
    if (waiting && !jobs.some(jobRunning)) {
      try {
        const started = await spawnUpdateWorker(waiting);
        jobs = jobs.map((job) => job.harness === started.harness ? started : job);
      } catch (cause) {
        // Starting it failed (the worker is missing, the spec is unwritable).
        // The record says so instead of sitting in the queue forever.
        const failed: HarnessUpdateJob = {
          ...waiting,
          finishedAt: Date.now(),
          pid: null,
          ok: false,
          applied: true,
          message: `${waiting.label} update could not start: ${cause instanceof Error ? cause.message : String(cause)}`,
        };
        await writeUpdateJob(failed, getHarnessUpdateStatusPath(waiting.harness));
        jobs = jobs.map((job) => job.harness === failed.harness ? failed : job);
      }
    }

    syncTicker(jobs);
    return jobs;
  });
}
