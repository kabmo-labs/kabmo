/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Carry-over: the one capability lost by not calling `omp worktree add`.
 *
 * Plain git does NOT copy ignored files — measured: a repository with
 * `node_modules` and a `.gitignore` yields a worktree holding only the tracked
 * files, so the agent's first `bun run dev` fails on a project that was working
 * a second earlier. This copies the ignored build folders with a copy-on-write
 * clone where the filesystem has one.
 *
 * Every path is checked with `git check-ignore`: the allow-list only narrows
 * WHAT to ask about, it never substitutes for git's answer. A candidate that is
 * tracked, or that does not exist, is skipped rather than guessed at.
 */

import { existsSync, statSync } from 'fs';
import { copyFile, mkdir } from 'fs/promises';
import path from 'path';
import { runGit } from '@/server/lib/fs/git-run';
import { pathExists } from '@/server/lib/omp/core/paths';

/** Folders worth asking git about. A name here that git does not ignore is skipped. */
export const CARRY_CANDIDATES = [
  'node_modules',
  '.venv',
  'venv',
  'target',
  'dist',
  'build',
  'out',
  '.next',
  '.nuxt',
  '.turbo',
  '.parcel-cache',
  '.cache',
  'vendor',
  '__pycache__',
];

/** Files whose absence breaks a run and whose contents are not in git. */
export const CARRY_FILE_CANDIDATES = ['.env', '.env.local', '.env.development', '.env.production'];

export type CopyStrategy = 'clonefile' | 'reflink' | 'plain';

export function copyStrategy(platform: NodeJS.Platform = process.platform): CopyStrategy {
  if (platform === 'darwin') return 'clonefile';
  if (platform === 'linux') return 'reflink';
  return 'plain';
}

export interface CarryResult {
  copied: string[];
  /** Candidates git does not call ignored, or that are not there. */
  skipped: string[];
  strategy: CopyStrategy;
}

async function isIgnored(repo: string, relative: string): Promise<boolean> {
  const probe = await runGit(['check-ignore', '--quiet', '--', relative], { cwd: repo });
  return probe.exitCode === 0;
}

/** `cp -c` (APFS clonefile) / `cp --reflink=auto` / `cp -R`, plus a Windows branch. */
async function copyTree(source: string, destination: string, strategy: CopyStrategy): Promise<void> {
  await mkdir(path.dirname(destination), { recursive: true });
  // A regular FILE (`.env`) is not a tree, and every branch below is a tree
  // copy. `robocopy` takes directories: measured on a Windows runner, a `.env`
  // source produced no file at the destination and no exit code the caller
  // reads as a failure, so the carry reported success and the worktree had no
  // env file — the one thing that path exists to prevent.
  if (!statSync(source).isDirectory()) {
    await copyFile(source, destination);
    return;
  }
  if (process.platform === 'win32') {
    const result = Bun.spawnSync({
      cmd: ['robocopy', source, destination, '/MIR', '/NFL', '/NDL', '/NJH', '/NJS', '/NC', '/NS', '/NP'],
      stdout: 'ignore',
      stderr: 'pipe',
    });
    // robocopy reports 0–7 as success codes; anything from 8 up is a real failure.
    if (result.exitCode !== null && result.exitCode >= 8) {
      throw new Error(`Failed to copy ${path.basename(source)}: ${result.stderr.toString().trim()}`);
    }
    return;
  }
  const args = strategy === 'clonefile' ? ['-cR'] : strategy === 'reflink' ? ['--reflink=auto', '-R'] : ['-R'];
  const result = Bun.spawnSync({ cmd: ['cp', ...args, source, destination], stdout: 'ignore', stderr: 'pipe' });
  if (result.exitCode !== 0) {
    throw new Error(`Failed to copy ${path.basename(source)}: ${result.stderr.toString().trim()}`);
  }
}

/**
 * Copy the project's ignored build folders and env files into a fresh worktree.
 *
 * A failure here is not a failed worktree: the caller reports what could not be
 * carried and keeps the checkout, because a worktree without `node_modules` is
 * still a worktree.
 */
export async function carryIgnoredInto(input: {
  primaryRoot: string;
  worktreePath: string;
  candidates?: string[];
}): Promise<CarryResult> {
  const strategy = copyStrategy();
  const copied: string[] = [];
  const skipped: string[] = [];

  const candidates = [...(input.candidates ?? CARRY_CANDIDATES), ...CARRY_FILE_CANDIDATES];
  for (const candidate of candidates) {
    const source = path.join(input.primaryRoot, candidate);
    if (!existsSync(source)) continue;
    if (!(await isIgnored(input.primaryRoot, candidate))) {
      skipped.push(candidate);
      continue;
    }
    const destination = path.join(input.worktreePath, candidate);
    // A tracked path already checked out in the worktree, or a directory that
    // appeared meanwhile, is not ours to overwrite.
    if (await pathExists(destination)) {
      skipped.push(candidate);
      continue;
    }
    await copyTree(source, destination, strategy);
    copied.push(candidate);
  }

  return { copied, skipped, strategy };
}