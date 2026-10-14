/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The stash: list, save, pop, apply, drop.
 *
 * The third-most-used verb in the agent's own session corpus (2784
 * invocations), and the natural partner of the conflict work: a conflicting
 * `git stash pop` is the ONE conflict shape that leaves no operation file, so
 * it is the case `git-state.ts` names `stash-pop` and aborts with
 * `git reset --merge HEAD` rather than an `--abort` verb.
 *
 * `git stash list --format='%gd|%gs|%ct'` is the read: `%gd` is the selector
 * (`stash@{0}`), `%gs` the reflog subject git wrote (`On main: wip test`), and
 * `%ct` the commit time. The default `stash@{0}: WIP on main: …` line would
 * have to be split on the first colon, and a branch name may contain one.
 */

import { runGit } from '@/server/lib/fs/git-run';
import { readGitState } from '@/server/lib/fs/git-state';

export interface StashEntry {
  /** The selector git accepts back — `stash@{0}`. */
  ref: string;
  /** The reflog subject, e.g. `On main: wip test`. */
  subject: string;
  /** The stash commit time, as a relative string for display. */
  date: string;
}

/** Runs a git command and throws with its stderr when it exits non-zero. */
async function expectOk(args: string[], cwd: string, timeout?: number): Promise<string> {
  const result = await runGit(args, { cwd, timeout, maxBuffer: 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || `git exited with code ${result.exitCode}`);
  }
  return result.stdout;
}

/**
 * The stash list's read.
 *
 * `%x09` is the TAB escape that WORKS here: `stash list` shares
 * `for-each-ref`'s format parser, but only the `%xNN` hex form is expanded —
 * `%09` comes through literally (measured: the ref arrived as
 * `stash@{0}%09On main: wip%091791962964`, one field containing the separator).
 * The default `stash@{0}: WIP on main: …` line would have to be split on the
 * first colon, and a branch name may contain one, which is why the format is
 * used at all.
 */
const STASH_FORMAT = '%gd%x09%gs%x09%ct';

export async function listStashes(targetDir: string): Promise<StashEntry[]> {
  const result = await runGit(
    ['stash', 'list', `--format=${STASH_FORMAT}`],
    { cwd: targetDir, timeout: 8_000 },
  );
  if (result.exitCode !== 0) return [];
  const stashes: StashEntry[] = [];
  for (const line of result.stdout.split('\n')) {
    if (!line.trim()) continue;
    const [ref, subject, seconds] = line.split('\t');
    if (!ref) continue;
    stashes.push({ ref, subject: subject ?? '', date: formatStashDate(seconds) });
  }
  return stashes;
}

/** A relative age from git's epoch seconds; the raw number is not for display. */
function formatStashDate(seconds: string): string {
  const at = Number(seconds) * 1000;
  if (!Number.isFinite(at) || at <= 0) return '';
  const delta = Date.now() - at;
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export interface StashPushOptions {
  targetDir: string;
  message?: string;
  /** Also stash untracked files (`-u`). */
  includeUntracked?: boolean;
}

/**
 * Stash the working tree.
 *
 * `-u` is opt-in and never implied: it sweeps untracked files into the stash,
 * which is a different promise from "set my changes aside" and can take a build
 * directory with it.
 */
export async function pushStash({ targetDir, message, includeUntracked }: StashPushOptions): Promise<void> {
  const args = ['stash', 'push'];
  if (message?.trim()) args.push('-m', message.trim());
  if (includeUntracked) args.push('-u');
  const output = await expectOk(args, targetDir, 60_000);
  // A clean tree answers "No local changes to save" with exit 0 — a success
  // that stashed nothing. Reported rather than swallowed, because the user
  // asked for a stash and did not get one.
  if (/No local changes to save/i.test(output)) throw new Error('Nothing to stash — the working tree is clean.');
}

/**
 * A stash ref, refused unless it is shaped like one.
 *
 * `stash@{0}` is the only form the panel ever sends, and the ref is a client
 * string: measured, `git stash apply --help` printed its usage instead of
 * applying anything, and `git stash drop --help` did the same — a ref that
 * begins with `-` is read as an OPTION. The grammar is exact (`stash@{N}`, or a
 * bare `N`), so anything else is a bug or a probe and both are refused here.
 */
function stashRefFor(value: string): string {
  const ref = value.trim() || 'stash@{0}';
  if (!/^(?:stash@\{\d+\}|\d+)$/.test(ref)) {
    throw new Error(`'${ref}' is not a stash reference.`);
  }
  return ref;
}

export interface StashApplyOptions {
  targetDir: string;
  ref: string;
  /** `pop` removes the entry after applying; `apply` keeps it. */
  pop?: boolean;
}

/**
 * Apply one stash entry.
 *
 * A conflict here is the `stash-pop` state: unmerged entries and NO operation
 * file, so the caller's abort is `git reset --merge HEAD`. `pop` deliberately
 * leaves the entry in place on a conflict (that is git's own behaviour — the
 * stash is only dropped on success), which is what makes the retry possible.
 */
export async function applyStash({ targetDir, ref, pop }: StashApplyOptions): Promise<void> {
  const result = await runGit(['stash', pop ? 'pop' : 'apply', stashRefFor(ref)], { cwd: targetDir, timeout: 60_000, maxBuffer: 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.exitCode === 0) return;
  // A `stash pop` that conflicts exits 1 with the changes applied and the
  // conflict in the working tree — the `stash-pop` state the panel draws. It is
  // not a failure, and reporting it as one hid the conflict it had just made.
  // The state is the proof: a real error (a bad ref, a dirty tree) leaves no
  // `stash-pop`.
  const state = await readGitState(targetDir);
  if (state.operation === 'stash-pop') return;
  throw new Error(result.stderr.trim() || result.stdout.trim() || `git exited with code ${result.exitCode}`);
}

/** Drop one stash entry. */
export async function dropStash(targetDir: string, ref: string): Promise<void> {
  await expectOk(['stash', 'drop', stashRefFor(ref)], targetDir, 30_000);
}
