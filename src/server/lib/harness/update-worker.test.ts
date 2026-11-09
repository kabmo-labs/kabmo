/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The detached worker that runs a harness update.
 *
 * These cases run the real `update-worker.ts` in a child process — the shape the
 * route actually spawns — because the properties that matter are about the
 * process boundary: progress is written to disk as steps complete, the first
 * failure ends the run, and a held lock refuses a second install instead of
 * racing it. A stubbed runner in-process would pass while the spawned worker
 * mishandled all three.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { packageDir } from '@/server/lib/fs/package-root';
import { flockAvailable, tryFlock } from '@/server/lib/lifecycle/flock';
import { writeUpdateJob } from '@/server/lib/harness/update-job-store';
import type { HarnessUpdateJob, HarnessUpdateJobSpec } from '@/shared/types/harness-update';

const WORKER = join(packageDir(), 'src', 'server', 'lib', 'harness', 'update-worker.ts');
let dir = '';

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'kabmo-update-worker-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** A step that runs the current runtime and exits with `code`. */
function step(part: string, code: number, print = ''): HarnessUpdateJobSpec['steps'][number] {
  const script = print ? `console.log(${JSON.stringify(print)}); process.exit(${code})` : `process.exit(${code})`;
  return { part, command: `${process.execPath} -e <script>`, argv: [process.execPath, '-e', script] };
}

function spec(steps: HarnessUpdateJobSpec['steps']): HarnessUpdateJobSpec {
  return {
    harness: 'claude',
    label: 'claude',
    steps,
    statusPath: join(dir, 'status.json'),
    lockPath: join(dir, 'update.lock'),
  };
}

async function runWorker(input: HarnessUpdateJobSpec): Promise<HarnessUpdateJob | null> {
  const specPath = join(dir, 'spec.json');
  await Bun.write(specPath, JSON.stringify(input));
  const proc = Bun.spawn({
    cmd: [process.execPath, WORKER, specPath],
    cwd: packageDir(),
    stdin: 'ignore',
    stdout: 'ignore',
    stderr: 'ignore',
  });
  await proc.exited;
  const raw = (await Bun.file(input.statusPath).json()) as unknown;
  return raw as HarnessUpdateJob | null;
}

describe('the update worker', () => {
  test('runs every step in order and reports the move', async () => {
    const job = await runWorker(spec([step('adapter', 0, 'installed'), step('Claude Code', 0)]));
    expect(job?.ok).toBe(true);
    expect(job?.steps.map((entry) => entry.state)).toEqual(['ok', 'ok']);
    expect(job?.steps.map((entry) => entry.part)).toEqual(['adapter', 'Claude Code']);
    // The sentence names every part that moved — one press can be two installs.
    expect(job?.message).toBe('claude updated (adapter + Claude Code)');
    expect(job?.output).toContain('installed');
    expect(job?.pid).toBeNull();
    expect(job?.finishedAt).not.toBeNull();
    // The server applies the caches and the launch line; the worker must not
    // claim it did.
    expect(job?.applied).toBe(false);
  });

  test('the first failure ends the run: later steps never execute', async () => {
    const job = await runWorker(spec([step('adapter', 3, 'boom'), step('Claude Code', 0)]));
    expect(job?.ok).toBe(false);
    expect(job?.steps[0].state).toBe('failed');
    expect(job?.steps[0].code).toBe(3);
    expect(job?.steps[1].state).toBe('pending');
    expect(job?.message).toBe('claude update failed (exit 3)');
    expect(job?.output).toContain('boom');
  });

  test.skipIf(!flockAvailable())('a held lock refuses a second install', async () => {
    const input = spec([step('adapter', 0)]);
    // The record the server wrote before spawning, as a poll would see it.
    const running: HarnessUpdateJob = {
      harness: 'claude',
      label: 'claude',
      startedAt: Date.now(),
      finishedAt: null,
      pid: null,
      steps: [{ ...input.steps[0], state: 'pending', code: null }],
      output: '',
      ok: null,
      message: null,
      applied: false,
      repointed: null,
    };
    await writeUpdateJob(running, input.statusPath);
    const held = tryFlock(input.lockPath);
    expect(held).not.toBeNull();

    const job = await runWorker(input);
    held?.release();
    expect(job?.ok).toBe(false);
    expect(job?.message).toContain('already running');
  });
});
