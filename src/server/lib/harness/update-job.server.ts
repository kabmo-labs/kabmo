/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Starting a harness update in the background, and applying what a finished one
 * left behind.
 *
 * The POST that asks for an update answers as soon as the worker is spawned; the
 * worker (`update-worker.ts`) owns the install and writes its progress to disk.
 * This module is the server half: it refuses a second run, starts the worker,
 * and — on the next status read — does the two things a detached process cannot
 * do for itself: drop the cached probe/CLI-version reads, and point an adapter's
 * launch line at the binary the install wrote.
 *
 * **The refusal is a fact on disk, not a flag in memory.** The old route had no
 * single-flight at all: a page reload mid-install offered the button again, and a
 * second `npm install -g` over the same prefix is how an npm tree gets corrupted.
 * The check reads the same record the worker writes, so a second tab and a
 * second server instance see the same answer.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { resolveBunBin } from '@/server/lib/lifecycle/bun';
import { packageDir } from '@/server/lib/fs/package-root';
import {
  getHarnessUpdateLockPath,
  getHarnessUpdateSpecPath,
  getHarnessUpdateStatusPath,
} from '@/server/lib/lifecycle/paths';
import { forgetProbe } from '@/server/lib/harness/probe-cache.server';
import { forgetCliVersion } from '@/server/lib/harness/update-state.server';
import { jobInFlight, readUpdateJob, settleDeadJob, writeUpdateJob } from '@/server/lib/harness/update-job-store';
import { loadHarnessConfig, saveHarnessConfig } from '@/server/lib/harness/config.server';
import { invalidateOmpCliCache } from '@/server/lib/omp/core/cli';
import { harnessUpdateFacts, type HarnessUpdateFacts } from '@/shared/lib/harness/updates';
import { repointAdapterLaunch, type HarnessUpdateStep } from '@/shared/lib/harness/update-plan';
import { HARNESS_IDS, type HarnessId } from '@/shared/lib/harness/catalog';
import type { HarnessUpdateJob, HarnessUpdateJobSpec } from '@/shared/types/harness-update';

/**
 * Where the worker's source lives inside this package.
 *
 * Derived from the package root rather than `import.meta.dir`: in production the
 * server runs the AOT bundle in `dist/client`, so this module's own directory is
 * not the source tree. `src/` ships in the tarball (`package.json#files`), which
 * is what makes the path valid in an installed copy too.
 */
function workerPath(): string {
  return join(packageDir(), 'src', 'server', 'lib', 'harness', 'update-worker.ts');
}

/** The current record, with a run that died without reporting turned into a failure. */
export async function currentUpdateJob(): Promise<HarnessUpdateJob | null> {
  return settleDeadJob(await readUpdateJob());
}

/** The run in flight, or null. Used to refuse a second press with a reason. */
export async function runningUpdateJob(): Promise<HarnessUpdateJob | null> {
  const job = await currentUpdateJob();
  return jobInFlight(job) ? job : null;
}

/**
 * Spawn the worker for `steps` and return the record it will fill.
 *
 * The record is written BEFORE the spawn so a poll that arrives in between sees
 * "running" rather than "no update"; the pid is written immediately after, and
 * the start grace window covers the gap.
 */
export async function startHarnessUpdateJob(
  harness: HarnessId,
  label: string,
  steps: HarnessUpdateStep[],
): Promise<HarnessUpdateJob> {
  const worker = workerPath();
  if (!existsSync(worker)) {
    throw new Error(`The update worker is missing from ${worker} — reinstall Kabmo to restore it`);
  }

  const spec: HarnessUpdateJobSpec = {
    harness,
    label,
    steps,
    statusPath: getHarnessUpdateStatusPath(),
    lockPath: getHarnessUpdateLockPath(),
  };
  await Bun.write(getHarnessUpdateSpecPath(), JSON.stringify(spec, null, 2));

  const startedAt = Date.now();
  const job: HarnessUpdateJob = {
    harness,
    label,
    startedAt,
    finishedAt: null,
    pid: null,
    steps: steps.map((step) => ({ ...step, state: 'pending', code: null })),
    output: '',
    ok: null,
    message: null,
    applied: false,
    repointed: null,
  };
  await writeUpdateJob(job);

  const child = Bun.spawn({
    cmd: [resolveBunBin(), worker, getHarnessUpdateSpecPath()],
    cwd: packageDir(),
    stdin: 'ignore',
    // Nothing is read back from stdio: the worker reports through the record, so
    // the install cannot be wedged by a parent that stopped draining a pipe.
    stdout: 'ignore',
    stderr: 'ignore',
    detached: true,
  });
  // Never adopted by this process: the worker has to survive a server exit, and
  // `unref` is what keeps the event loop from waiting on it.
  child.unref();

  job.pid = child.pid ?? null;
  await writeUpdateJob(job);
  return job;
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

async function finalizeOnce(): Promise<HarnessUpdateJob | null> {
  const job = await currentUpdateJob();
  if (!job || job.finishedAt === null || job.applied) return job;

  // The record is a file, so its id is not proof of a catalog entry; an unknown
  // one has no facts and nothing to repoint — it is still marked applied, so it
  // is not re-finalized on every poll.
  const harness = HARNESS_IDS.includes(job.harness as HarnessId) ? job.harness as HarnessId : null;
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

  const settled: HarnessUpdateJob = {
    ...job,
    applied: true,
    repointed,
    message: job.ok && job.message
      ? `${job.message}${repointed ? ` — launches now run \`${repointed}\`` : ''} — check its status to read the new version`
      : job.message,
  };
  await writeUpdateJob(settled);
  return settled;
}

/**
 * One finalize at a time, and only once per finished run.
 *
 * Two polls (two tabs, a poll racing the next one) would otherwise both see
 * `applied: false` and both repoint the launch line; the work is idempotent, but
 * the message would be composed twice.
 */
let finalizing: Promise<HarnessUpdateJob | null> | null = null;

export async function finalizeUpdateJob(): Promise<HarnessUpdateJob | null> {
  finalizing ??= finalizeOnce();
  try {
    return await finalizing;
  } finally {
    finalizing = null;
  }
}
