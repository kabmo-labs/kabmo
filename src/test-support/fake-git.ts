/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A `git` the code under test can spawn, on every platform.
 *
 * The suites that pin the wiki read path need a program that records the argv it
 * received and answers `init`/`fetch`/`log` deterministically — no network, no
 * real repository. `executable-stub` compiles it, so the same fixture starts on
 * Windows, where a `#!/bin/sh` script cannot.
 *
 * The env hooks are the whole API, and each one exists because a case needs to
 * provoke a failure the real binary produces only in the wild:
 *
 *   - `FAKE_GIT_LOG` — append `CALL\targ…` per invocation.
 *   - `FAKE_GIT_SIGNAL` — kill the child with that signal (POSIX only).
 *   - `FAKE_GIT_SLEEP` — outlive the caller's budget, so its timeout kill ends it.
 *   - `FAKE_GIT_FETCH_KILL` / `FAKE_GIT_FETCH_FAIL` — a fetch that dies or refuses.
 *   - `FAKE_GIT_LOG_FAIL` — a `log` that exits non-zero (an empty mirror).
 *   - `FAKE_GIT_REVISION` / `FAKE_GIT_UPDATED` — the `log` answer.
 */

import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';

import { executableStub } from '@/test-support/executable-stub';
import { removeDir } from '@/test-support/remove-dir';

/** Directories a suite created, so its teardown can remove them. */
const dirs: string[] = [];

/** A temp directory registered for removal by {@link cleanupFakeGit}. */
export function fakeGitTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

const FAKE_GIT_SOURCE = `import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const log = process.env.FAKE_GIT_LOG;
if (log) appendFileSync(log, 'CALL' + (args.length ? '\\t' + args.join('\\t') : '') + '\\n');
const signal = process.env.FAKE_GIT_SIGNAL;
if (signal) process.kill(process.pid, signal.startsWith('SIG') ? signal : 'SIG' + signal);
const sleep = process.env.FAKE_GIT_SLEEP;
if (sleep) {
  // Outlives the caller's budget, so the timeout kill is what ends it.
  await Bun.sleep(Number(sleep));
  process.exit(0);
}
if (args[0] === 'init') {
  mkdirSync(args[3], { recursive: true });
  writeFileSync(join(args[3], 'HEAD'), '');
  process.exit(0);
}
if (args[2] === 'fetch') {
  if (process.env.FAKE_GIT_FETCH_KILL) process.kill(process.pid, 'SIGTERM');
  if (process.env.FAKE_GIT_FETCH_FAIL) {
    process.stderr.write(process.env.FAKE_GIT_FETCH_FAIL + '\\n');
    process.exit(128);
  }
  process.exit(0);
}
if (args[2] === 'log') {
  if (process.env.FAKE_GIT_LOG_FAIL) process.exit(1);
  process.stdout.write((process.env.FAKE_GIT_REVISION || 'abc123') + '\\n');
  process.stdout.write((process.env.FAKE_GIT_UPDATED || '2026-01-02T03:04:05Z') + '\\n');
  process.exit(0);
}
for (const arg of args) process.stdout.write(arg + '\\n');
process.stdout.write('ENV=' + (process.env.GIT_TERMINAL_PROMPT ?? '') + '\\n');
`;

/** The `PATH` this process started with, so a suite can put it back. */
export const realPath = process.env.PATH;

/** Every env hook the stub reads, for a suite's `afterEach`. */
export const FAKE_GIT_ENV_KEYS = [
  'FAKE_GIT_LOG',
  'FAKE_GIT_SIGNAL',
  'FAKE_GIT_SLEEP',
  'FAKE_GIT_FETCH_KILL',
  'FAKE_GIT_FETCH_FAIL',
  'FAKE_GIT_LOG_FAIL',
  'FAKE_GIT_REVISION',
  'FAKE_GIT_UPDATED',
] as const;

let gitLog = '';

/**
 * Put the recording stub first on `PATH`, so every spawn reaches it.
 *
 * Returns the log path the stub appends to; {@link gitCalls} parses it.
 */
export async function useFakeGit(): Promise<string> {
  const fakeGit = await executableStub(FAKE_GIT_SOURCE, 'git');
  gitLog = join(fakeGitTempDir('omp-git-log-'), 'calls.log');
  process.env.PATH = `${dirname(fakeGit)}${delimiter}${realPath}`;
  process.env.FAKE_GIT_LOG = gitLog;
  return gitLog;
}

/** Every recorded argv, in call order. */
export function gitCalls(): string[][] {
  return readFileSync(gitLog, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => line.split('\t').slice(1));
}

/** Remove every temp directory a suite registered. */
export function cleanupFakeGit(): void {
  for (const dir of dirs.splice(0)) removeDir(dir);
}
