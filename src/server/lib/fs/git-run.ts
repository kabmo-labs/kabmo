/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
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
      // No terminal to answer a credential prompt: without this a `pull` on a
      // private remote blocks until its timeout instead of reporting why.
      //
      // `GIT_EDITOR=true` is the same fix for the other prompt git can raise: a
      // merge, rebase or cherry-pick that needs a commit message opens an
      // editor, and there is no terminal to draw one in. Measured twice on a
      // resolved conflict — with `GIT_EDITOR` unset, `git merge --continue`
      // fails with "error: Terminal is dumb, but EDITOR unset"; with a real
      // `GIT_EDITOR=vim` inherited from the environment (and `core.editor=vim`
      // configured), it BLOCKS on vim until the timeout kills it. `true`
      // accepts the message git prepared, which is what `--no-edit` would do.
      env: { ...Bun.env, GIT_TERMINAL_PROMPT: '0', GIT_EDITOR: 'true' },
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
