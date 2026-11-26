/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * What a commit message is written FROM: the staged change set, the branch, and
 * the recent subjects that carry the repository's own style.
 *
 * Staged only, because `git commit` writes the index. A prompt built from
 * `git diff` would describe changes the commit does not contain — the failure
 * Orca's #20112 reports from the other direction (a template that ignored the
 * staged diff entirely). The one exception is an amend with nothing staged:
 * `git commit --amend` then rewrites the previous commit's message, so the
 * commit being rewritten is the change set.
 *
 * The caps are the model's context, not the repository's size: 30 files and
 * 120k characters, with a visible truncation marker. A silent cut is how a
 * generated message describes half a change and reads as complete.
 */

import { runGit } from '@kabmo-labs/kabmo-git/runner/git-run';

export interface CommitContext {
  branch: string;
  files: string[];
  diff: string;
  recentCommits: string[];
  /** True when the file list or the diff was cut to fit the model. */
  truncated: boolean;
  /** True when the diff is the commit being amended, not the index. */
  amend: boolean;
}

const MAX_FILES = 30;
const MAX_DIFF_CHARS = 120_000;
const RECENT_COMMITS = 10;

async function gitOut(
  args: string[],
  cwd: string,
  timeout = 10_000,
  maxBuffer = 4 * 1024 * 1024,
): Promise<string> {
  const result = await runGit(args, { cwd, timeout, maxBuffer });
  return result.exitCode === 0 && !result.error ? result.stdout : '';
}

function lines(value: string): string[] {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

export async function readCommitContext(targetDir: string, amend: boolean): Promise<CommitContext> {
  const branch = (await gitOut(['rev-parse', '--abbrev-ref', 'HEAD'], targetDir, 5_000)).trim() || 'HEAD';
  const recentCommits = lines(await gitOut(['log', '-n', String(RECENT_COMMITS), '--format=%s'], targetDir, 5_000));

  const stagedFiles = lines(await gitOut(['diff', '--cached', '--name-only'], targetDir));
  const stagedDiff = await gitOut(['diff', '--cached', '--no-color'], targetDir, 15_000, 8 * 1024 * 1024);
  if (stagedFiles.length > 0 || stagedDiff.trim().length > 0) {
    return { branch, files: stagedFiles, diff: stagedDiff, recentCommits, truncated: false, amend };
  }

  if (!amend) {
    return { branch, files: [], diff: '', recentCommits, truncated: false, amend };
  }

  // Amend with nothing staged: the commit being rewritten is the change set.
  const headFiles = lines(await gitOut(['show', '--name-only', '--format=', 'HEAD'], targetDir));
  const headDiff = await gitOut(['show', '--format=', '--patch', '--no-color', 'HEAD'], targetDir, 15_000, 8 * 1024 * 1024);
  return { branch, files: headFiles, diff: headDiff, recentCommits, truncated: false, amend: true };
}

export function limitCommitContext(context: CommitContext): CommitContext {
  const files = context.files.slice(0, MAX_FILES);
  let diff = context.diff;
  let truncated = context.files.length > MAX_FILES;
  if (diff.length > MAX_DIFF_CHARS) {
    diff = `${diff.slice(0, MAX_DIFF_CHARS)}\n[remaining diff truncated]`;
    truncated = true;
  }
  return { ...context, files, diff, truncated };
}
