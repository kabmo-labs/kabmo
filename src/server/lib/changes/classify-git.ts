/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The `git` branch of the command classifier.
 *
 * `git` is the one verb whose effect depends on a subcommand, and the split is
 * deliberate: a read-only subcommand (`status`, `diff`, `log`) is not a
 * mutation; a path restore (`checkout --`, `restore`) names its files; and a
 * subcommand that rewrites the tree in ways argv cannot name (`reset --hard`,
 * `clean`, `stash`) is opaque, so the scan pass answers instead of a guess.
 */

import type { CommandMutation, CommandPlan, MutationOp } from '@/server/lib/changes/classify-command';
import { isSpecialFile, nonFlagArgs, resolvePath } from '@/server/lib/changes/classify-paths';

/** `git` subcommands that never write the working tree. */
const GIT_READ_ONLY: Record<string, true> = {
  status: true, diff: true, log: true, show: true, branch: true,
  'rev-parse': true, 'ls-files': true, remote: true, config: true,
  blame: true, describe: true, tag: true, shortlog: true, reflog: true,
  grep: true, 'ls-tree': true, 'cat-file': true, 'show-ref': true,
  'for-each-ref': true, add: true, commit: true, fetch: true, push: true,
  init: true, clone: true, help: true, version: true, 'count-objects': true,
  fsck: true,
};

/** `git` subcommands that rewrite the working tree in ways argv cannot name. */
const GIT_OPAQUE: Record<string, true> = {
  clean: true, reset: true, stash: true, apply: true, am: true,
  rebase: true, merge: true, pull: true, 'cherry-pick': true, revert: true,
  bisect: true, worktree: true, submodule: true, 'filter-branch': true,
};

export function classifyGit(
  args: readonly string[],
  cwd: string,
  home: string,
  mutations: CommandMutation[],
  opaque: boolean,
  readOnly: boolean,
  scan: boolean,
): CommandPlan {
  const sub = args[0];
  if (!sub) return { mutations, opaque, readOnly, scan };
  if (GIT_READ_ONLY[sub] === true) return { mutations, opaque, readOnly, scan };

  const add = (op: MutationOp, raw: string, from?: string): void => {
    if (isSpecialFile(raw)) return;
    const resolved = resolvePath(cwd, home, raw);
    if (!resolved) {
      opaque = true;
      return;
    }
    mutations.push(from ? { op, path: resolved, from } : { op, path: resolved });
    readOnly = false;
  };

  if (sub === 'mv') {
    const files = nonFlagArgs(args.slice(1));
    if (files.length < 2) return { mutations, opaque: true, readOnly: false, scan: true };
    const from = resolvePath(cwd, home, files[0]);
    const to = resolvePath(cwd, home, files[files.length - 1]);
    if (!from || !to) return { mutations, opaque: true, readOnly: false, scan: true };
    mutations.push({ op: 'rename', path: to, from });
    return { mutations, opaque, readOnly: false, scan };
  }
  if (sub === 'rm') {
    for (const file of nonFlagArgs(args.slice(1))) add('delete', file);
    return { mutations, opaque, readOnly, scan };
  }
  if (sub === 'checkout' || sub === 'restore') {
    const separator = args.indexOf('--');
    if (separator !== -1) {
      for (const file of args.slice(separator + 1)) add('update', file);
      return { mutations, opaque, readOnly, scan };
    }
    if (sub === 'restore') {
      for (const file of nonFlagArgs(args.slice(1))) add('update', file);
      return { mutations, opaque, readOnly, scan };
    }
    return { mutations, opaque: true, readOnly: false, scan: true };
  }
  if (GIT_OPAQUE[sub] === true) return { mutations, opaque: true, readOnly: false, scan: true };

  return { mutations, opaque: true, readOnly: false, scan: true };
}
