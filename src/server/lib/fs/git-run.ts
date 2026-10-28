/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * `git` as ARGV, plus the path guard the mutating actions need.
 *
 * The Source Control panel's actions used to build shell strings —
 * `git add "${file}"`, `git commit -m "${message}"` — and both operands are
 * user-controlled. A repository is free to hold a file called
 * `evil$(touch /tmp/pwn).txt`, and a commit message is free to hold backticks
 * or a `$( )`: `sh -c` expands them. Measured against the previous runner, a
 * commit message of ``fix `touch /tmp/PWN` thing`` created the file and
 * committed `fix  thing`. The same shape silently broke the actions a reader
 * would call normal: a filename holding a double quote made `git add` exit 2
 * with `unexpected EOF while looking for matching '"'`, and the revert path
 * read that failure as "the file is untracked" and deleted it.
 *
 * Passing every operand as its own argv element removes the shell from the
 * picture entirely — the rule `lib/wiki/git.ts` already follows, for the same
 * reason.
 *
 * `resolveRepoPath` is the second half: `git` runs with a cwd, so a relative
 * path is bounded by git itself — but the untracked-file branch REMOVES what
 * the path names, and `path.join(targetDir, '../../x')` escapes the working
 * tree. Nothing that reaches the filesystem may be built from a client string
 * without this check.
 */

import path from 'path';
import { isWithinRoot } from '@/server/lib/fs/root';
import { isUnmergedCode } from '@/shared/lib/fs/git-unmerged';
import type { GitChange } from '@/shared/types';

export interface GitRunResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signalCode: NodeJS.Signals | null;
  killed: boolean;
  /** Set only when the spawn itself failed (git missing, bad cwd). */
  error?: Error;
}

/**
 * The environment every `git` invocation gets, whether it is spawned as argv
 * (`runGit`) or through a shell (`runShell`).
 *
 * Three variables, each the fix for a failure measured in this repository:
 *
 * - `GIT_TERMINAL_PROMPT=0` — no terminal to answer a credential prompt, so a
 *   `pull` on a private remote would otherwise block to its timeout.
 * - `GIT_EDITOR=true` — no terminal for the editor a merge/rebase/cherry-pick
 *   opens for its commit message. Measured: unset, `git merge --continue` fails
 *   with "Terminal is dumb, but EDITOR unset"; a real `GIT_EDITOR=vim` inherited
 *   from the environment BLOCKS until the timeout kills it.
 * - `GIT_OPTIONAL_LOCKS=0` — a READ must not take `.git/index.lock`. `git status`
 *   is not read-only: with a STALE index (a working file newer than the stat the
 *   index recorded — i.e. right after a checkout or a merge) it refreshes the
 *   index and writes it back. The panel runs those reads on its own schedule
 *   (the repo modal's per-repo read, the status payload on every tool call), so
 *   a merge issued while one was in flight lost the race and failed with
 *   `Unable to create '.git/index.lock': File exists` — reproduced: 8 of 8
 *   rounds with a concurrent `git status` on a stale index, 0 of 10 with this
 *   set. That is the `git action merge_branch failed (HTTP 400)` the browser
 *   specs caught. The lock is only an optimization (it lets the next read skip
 *   re-stat'ing); a mutating command takes it either way, which is correct.
 *
 * It is exported rather than inlined at each spawn so a new git call site cannot
 * silently miss it — the status read goes through `runShell`, not `runGit`, and
 * that split is exactly how one of the two paths would have kept the bug.
 */
export const GIT_ENV = {
  GIT_TERMINAL_PROMPT: '0',
  GIT_EDITOR: 'true',
  GIT_OPTIONAL_LOCKS: '0',
} as const;

export interface GitRunOptions {
  cwd: string;
  /** Signal the process group after this many milliseconds. */
  timeout?: number;
  maxBuffer?: number;
}

/**
 * Run one `git` command with `args` as argv elements.
 *
 * Exit handling is explicit, exactly as `runShell`'s is: Bun does not throw for
 * a non-zero exit, so callers check `exitCode` and `error`. A timeout signals
 * the whole process GROUP, because a hook or a pager that outlives the git
 * process would otherwise keep the pipes open past the deadline.
 */
export async function runGit(args: string[], options: GitRunOptions): Promise<GitRunResult> {
  const timeout = options.timeout;
  const groupKill = timeout !== undefined && process.platform !== 'win32';
  let proc: Bun.Subprocess<'ignore', 'pipe', 'pipe'>;
  try {
    proc = Bun.spawn({
      cmd: ['git', ...args],
      cwd: options.cwd,
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
      detached: groupKill,
      maxBuffer: options.maxBuffer ?? 1024 * 1024,
      // `GIT_TERMINAL_PROMPT`, `GIT_EDITOR` and `GIT_OPTIONAL_LOCKS` — see
      // `GIT_ENV` above for what each one prevents and how it was measured.
      env: { ...Bun.env, ...GIT_ENV },
    });
  } catch (error) {
    return {
      stdout: '',
      stderr: error instanceof Error ? error.message : String(error),
      exitCode: null,
      signalCode: null,
      killed: false,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }

  const timer = timeout === undefined
    ? undefined
    : setTimeout(() => {
        try {
          if (groupKill) process.kill(-proc.pid, 'SIGTERM');
          else proc.kill('SIGTERM');
        } catch {
          // Already gone: the command finished inside its own timeout.
        }
      }, timeout);

  let error: Error | undefined;
  let stdout = '';
  let stderr = '';
  try {
    [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
  } catch (err) {
    error = err instanceof Error ? err : new Error(String(err));
  }
  const exitCode = await proc.exited;
  clearTimeout(timer);
  return {
    stdout,
    stderr,
    exitCode,
    signalCode: proc.signalCode,
    killed: proc.killed,
    ...(error ? { error } : {}),
  };
}

/**
 * A client-supplied repo-relative path, resolved to an absolute one inside
 * `targetDir` — or null when it names something outside it.
 *
 * An empty path is refused rather than treated as the repo root: every caller
 * here is acting on ONE change, and `git add ''` is an error while
 * `git restore ''` is not.
 */
export function resolveRepoPath(targetDir: string, rel: string): string | null {
  const trimmed = (rel ?? '').trim();
  if (!trimmed) return null;
  // Git speaks POSIX separators; a client on Windows may hand back backslashes.
  const normalized = trimmed.split('\\').join(path.sep);
  const resolved = path.resolve(targetDir, normalized);
  return isWithinRoot(targetDir, resolved) ? resolved : null;
}

/** The repo-relative form git itself wants, from a path a client supplied. */
export function repoRelative(rel: string): string {
  return (rel ?? '').trim().split('\\').join('/');
}

/**
 * Parse `git status --porcelain=v1 -z` output into change rows.
 *
 * `-z` is the only LOSSLESS form, and both of the other form's losses bite the
 * diff panel. A path holding a space or any non-ASCII byte comes back QUOTED
 * with its non-ASCII bytes octal-escaped (`"\303\274n..."`), and no JSON decode
 * reverses that — `JSON.parse` turns it into the literal text `\303\274`, a
 * path that does not exist, so the diff for every accented filename read as
 * "No differences found". `-z` never quotes and never escapes. It also replaces
 * the `old -> new` spelling with a second NUL-terminated field, so a rename is
 * unwrapped from its own record instead of by splitting on a separator that a
 * filename is free to contain.
 *
 * A rename or copy spends TWO records — the new path, then the old one — and
 * only the first is a path the working tree still has.
 */
export function parsePorcelainZ(out: string): GitChange[] {
  const records = out.split('\0');
  const changes: GitChange[] = [];
  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    // The trailing empty record, and anything shorter than `XY p`.
    if (record.length < 4) continue;
    const status = record.slice(0, 2);
    const code = status[0] === 'R' || status[0] === 'C' ? status[0] : status[1];
    if (code === 'R' || code === 'C') i += 1;
    changes.push({
      status,
      file: record.slice(3),
      // An unmerged pair is the two SIDES of a conflict, not an index/worktree
      // pair: `UU` has no space in either column, so the test below marked every
      // conflicted file as staged — and the list then rendered it under "Staged
      // Changes" AND under "Changes" (the worktree half of the same test also
      // passes for `UU`). A conflicted file is neither; it is its own section.
      staged: !isUnmergedCode(status) && status[0] !== ' ' && status[0] !== '?',
      additions: 1,
      deletions: 0,
    });
  }
  return changes;
}
