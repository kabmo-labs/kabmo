/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The detached process that actually installs a harness update.
 *
 * Why a process of its own, and not an `await` in the route:
 *
 *  - **It outlives the request.** The POST answers while this runs, so closing
 *    the dialog, reloading the page or a `bun --hot` reload cannot interrupt an
 *    install halfway through writing a package tree.
 *  - **Nothing kills it for being slow.** The old path bounded the whole update
 *    at five minutes and killed the child; a large native package on a slow link
 *    then died MID-WRITE, which is exactly how an `npm` prefix ends up corrupt.
 *    The bound here is 30 minutes per step and only to stop a truly hung child.
 *  - **One install at a time.** `flock` on a lock file is held for the run and
 *    released by the kernel if this process dies, so a second server (or a
 *    second press after a reload) cannot run a competing `npm install -g` over
 *    the same prefix. A second harness's press is not refused any more — its
 *    record waits in the queue and this worker is spawned for it when the run
 *    ahead finishes.
 *
 * It writes the same record the server reads (`update-job-store.ts`), atomically,
 * at every state change and throttled while output streams. It cannot apply the
 * post-install side effects itself: those read the database, which the server
 * owns — `update-queue.server.ts` does that on its next pass.
 *
 * Run as: `bun <this file> <spec.json>`.
 */

import { flockAvailable, tryFlock, type FlockHandle } from '@/server/lib/lifecycle/flock';
import { OUTPUT_LIMIT } from '@/server/lib/updates/install-steps';
import { readUpdateJob, writeUpdateJob } from '@/server/lib/harness/update-job-store';
import type {
  HarnessUpdateJob,
  HarnessUpdateJobSpec,
  HarnessUpdateJobStep,
} from '@/shared/types/harness-update';

/**
 * Longest one step may run. Deliberately generous: `npm install -g` of a native
 * package is a large download plus a postinstall, and killing it mid-flight is
 * the corruption this whole module exists to avoid. A hung child is still
 * bounded.
 */
export const HARNESS_STEP_TIMEOUT_MS = 30 * 60_000;

/** How often streamed output is flushed to the record. */
const PROGRESS_FLUSH_MS = 400;

function tail(text: string): string {
  return text.length > OUTPUT_LIMIT ? `…\n${text.slice(-OUTPUT_LIMIT)}` : text;
}

function freshJob(spec: HarnessUpdateJobSpec): HarnessUpdateJob {
  return {
    harness: spec.harness,
    label: spec.label,
    startedAt: Date.now(),
    finishedAt: null,
    // This process IS the worker: a record that said it was waiting has been
    // taken over, so the stamp must not survive into the run.
    queuedAt: null,
    pid: process.pid,
    steps: spec.steps.map((step): HarnessUpdateJobStep => ({ ...step, state: 'pending', code: null })),
    output: '',
    ok: null,
    message: null,
    applied: false,
    repointed: null,
  };
}

/** Copy a child stream into `job.output`, flushing as it arrives. */
async function pump(
  stream: ReadableStream<Uint8Array>,
  append: (chunk: string) => Promise<void>,
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    if (chunk.length === 0) continue;
    await append(chunk);
  }
}

/** Run every planned step, stopping at the first failure. */
async function runSteps(spec: HarnessUpdateJobSpec, lock: FlockHandle | null): Promise<void> {
  const existing = await readUpdateJob(spec.statusPath);
  const job: HarnessUpdateJob = existing?.harness === spec.harness
    ? { ...existing, pid: process.pid, finishedAt: null, queuedAt: null, ok: null, applied: false }
    : freshJob(spec);
  // The plan always comes from the spec: the record on disk may be from an
  // earlier run of the same harness, and its steps must not be replayed.
  job.steps = spec.steps.map((step): HarnessUpdateJobStep => ({ ...step, state: 'pending', code: null }));
  job.output = '';
  await writeUpdateJob(job, spec.statusPath);

  let lastFlush = 0;
  const flush = async (force: boolean): Promise<void> => {
    const now = Date.now();
    if (!force && now - lastFlush < PROGRESS_FLUSH_MS) return;
    lastFlush = now;
    await writeUpdateJob(job, spec.statusPath);
  };

  let ok = true;
  for (let index = 0; index < job.steps.length; index += 1) {
    const step = job.steps[index];
    job.steps[index] = { ...step, state: 'running' };
    await flush(true);

    const proc = Bun.spawn({
      cmd: step.argv,
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: HARNESS_STEP_TIMEOUT_MS,
      env: { ...Bun.env, PAGER: 'cat', FORCE_COLOR: '0' },
    });
    const append = async (chunk: string): Promise<void> => {
      job.output = tail(job.output + chunk);
      await flush(false);
    };
    // Appended as they arrive, so the record streams while npm prints; joining
    // the captured text here as well printed every line twice.
    await Promise.all([pump(proc.stdout, append), pump(proc.stderr, append)]);
    const code = await proc.exited;

    if (code !== 0) {
      job.steps[index] = { ...job.steps[index], state: 'failed', code };
      job.message = `${spec.label} update failed (exit ${code ?? 'killed'})`;
      ok = false;
      await flush(true);
      break;
    }
    job.steps[index] = { ...job.steps[index], state: 'ok', code };
    await flush(true);
  }

  job.finishedAt = Date.now();
  job.pid = null;
  job.ok = ok;
  if (ok) {
    const moved = job.steps.map((step) => step.part).join(' + ');
    job.message = `${spec.label} updated (${moved})`;
  }
  await writeUpdateJob(job, spec.statusPath);
  lock?.release();
}

async function main(): Promise<void> {
  const specPath = process.argv[2];
  if (!specPath) {
    console.error('[kabmo] harness update worker: no spec path');
    process.exit(2);
  }
  const spec = (await Bun.file(specPath).json()) as HarnessUpdateJobSpec;

  // A host without flock (Windows, some NFS mounts) keeps the server-side
  // in-flight check as its only guard; refusing every update there would break
  // the feature on a platform that simply locks differently.
  const lock = flockAvailable() ? tryFlock(spec.lockPath) : null;
  if (flockAvailable() && !lock) {
    const running = await readUpdateJob(spec.statusPath);
    if (running && running.harness === spec.harness) {
      await writeUpdateJob({
        ...running,
        finishedAt: Date.now(),
        pid: null,
        ok: false,
        applied: true,
        message: `${spec.label} update is already running in another process`,
      }, spec.statusPath);
    }
    return;
  }

  try {
    await runSteps(spec, lock);
  } catch (cause) {
    const running = await readUpdateJob(spec.statusPath);
    const base = running ?? freshJob(spec);
    await writeUpdateJob({
      ...base,
      finishedAt: Date.now(),
      pid: null,
      ok: false,
      applied: true,
      message: `${spec.label} update failed: ${cause instanceof Error ? cause.message : String(cause)}`,
    }, spec.statusPath);
    lock?.release();
    process.exitCode = 1;
  }
}

void main();
