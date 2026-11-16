/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * What a `bash` command will do to the working tree, read from its text.
 *
 * omp's shell trace gives exact `argv` and exit status per simple command, but
 * it does NOT model redirections. Measured on 18.20.3: `bun test > /tmp/n1.log
 * 2>&1` produces only `and_or`/`pipeline`/`simple`/`word` nodes, and the
 * `simple` node's argv is `["bun","test"]` — the `>` and its target are absent.
 * So the classifier has two entry points:
 *
 *   - {@link classifyCommand} — the whole script, tokenized here, used at
 *     `tool_execution_start` to snapshot the targets BEFORE the command runs;
 *   - {@link classifyArgv} — one already-parsed `argv` from the trace, used at
 *     `tool_execution_end` to confirm what actually ran.
 *
 * A command is `readOnly` when every simple command is a known read-only verb
 * and there is no output redirect. It is `opaque` when at least one command is
 * not understood — a script, a build, `git reset --hard` — which is the signal
 * for the filesystem reconciliation pass rather than a guess.
 *
 * A path containing a glob character is not resolved: the shell expands it, and
 * a guess would journal a file that was never touched. The command is marked
 * opaque instead, so the scan pass answers.
 */

import path from 'node:path';
import { classifyGit } from '@/server/lib/changes/classify-git';
import {
  dedupe,
  flagValue,
  isSpecialFile,
  nonFlagArgs,
  resolvePath,
  scriptFiles,
  truncateFiles,
} from '@/server/lib/changes/classify-paths';
import {
  splitCommands,
  stripHeredocs,
  tokenizeCommand,
  type SimpleCommand,
} from '@/server/lib/changes/classify-tokenize';

export type MutationOp = 'create' | 'update' | 'delete' | 'rename';

export interface CommandMutation {
  op: MutationOp;
  /** Absolute path. */
  path: string;
  /** Absolute source path, for a rename. */
  from?: string;
}

export interface CommandPlan {
  mutations: CommandMutation[];
  /** At least one command is not understood; the scan pass must run. */
  opaque: boolean;
  /** Every command is a known read-only verb and there is no output redirect. */
  readOnly: boolean;
}

/** Verbs that never write a file. */
const READ_ONLY: Record<string, true> = {
  ls: true, cat: true, head: true, tail: true, wc: true, rg: true, grep: true,
  fd: true, stat: true, file: true, which: true, pwd: true,
  echo: true, printf: true, date: true, env: true, printenv: true, whoami: true,
  id: true, uname: true, du: true, df: true, tree: true, jq: true,
  basename: true, dirname: true, realpath: true, readlink: true,
  cut: true, tr: true, nl: true, od: true, strings: true,
  diff: true, cmp: true, comm: true, paste: true, fold: true, seq: true,
  yes: true, true: true, false: true, test: true, '[': true, sleep: true,
  kill: true, ps: true, top: true, lsof: true, cd: true, export: true,
  set: true, unset: true, chmod: true, chown: true, mkdir: true, wait: true,
  jobs: true, bg: true, fg: true, type: true, command: true, hash: true,
  umask: true, ulimit: true,
};

/** Verbs whose effect cannot be read from argv; the scan pass answers. */
const OPAQUE: Record<string, true> = {
  bun: true, bunx: true, npm: true, npx: true, pnpm: true, yarn: true,
  node: true, deno: true, python: true, python3: true, pip: true, pip3: true,
  sh: true, bash: true, zsh: true, fish: true, make: true, cargo: true,
  rustc: true, go: true, tsc: true, eslint: true, prettier: true,
  playwright: true, vitest: true, jest: true, tar: true, unzip: true,
  zip: true, rsync: true, scp: true, ssh: true, docker: true, kubectl: true,
  helm: true, terraform: true, ansible: true, systemctl: true, launchctl: true,
  brew: true, apt: true, 'apt-get': true, yum: true, dnf: true, pacman: true,
  sudo: true, su: true, eval: true, exec: true, nohup: true, timeout: true,
  parallel: true, 'git-lfs': true, gh: true, glab: true, aws: true,
  gcloud: true, az: true, xargs: true, source: true, '.': true, time: true,
  watch: true,
};

/** Classify one already-parsed `argv` (the shell trace's `simple` node). */
export function classifyArgv(argv: readonly string[], cwd: string, home: string): CommandPlan {
  return classifySimple({ words: [...argv], redirects: [] }, cwd, home);
}

/** Classify a whole script, including its output redirects and `cd` changes. */
export function classifyCommand(script: string, cwd: string, home: string): CommandPlan {
  const mutations: CommandMutation[] = [];
  let opaque = false;
  let readOnly = true;
  let currentCwd = cwd;
  for (const command of splitCommands(tokenizeCommand(stripHeredocs(script)))) {
    const verb = command.words[0] ? path.basename(command.words[0]) : '';
    if (verb === 'cd') {
      // A `cd` changes what every later relative path means. `cd -` and a bare
      // `cd` are not tracked, so the command is opaque rather than guessed.
      const target = command.words.slice(1).find((arg) => !arg.startsWith('-'));
      const resolved = target ? resolvePath(currentCwd, home, target) : null;
      if (resolved) currentCwd = resolved;
      else opaque = true;
      continue;
    }
    const result = classifySimple(command, currentCwd, home);
    mutations.push(...result.mutations);
    if (result.opaque) opaque = true;
    if (!result.readOnly) readOnly = false;
  }
  return { mutations: dedupe(mutations), opaque, readOnly };
}

function classifySimple(command: SimpleCommand, cwd: string, home: string): CommandPlan {
  const mutations: CommandMutation[] = [];
  let opaque = false;
  let readOnly = true;

  const add = (op: MutationOp, raw: string, from?: string): void => {
    // `/dev/null` and friends are redirect sinks, not working-tree mutations.
    if (isSpecialFile(raw)) return;
    const resolved = resolvePath(cwd, home, raw);
    if (!resolved) {
      opaque = true;
      return;
    }
    mutations.push(from ? { op, path: resolved, from } : { op, path: resolved });
    readOnly = false;
  };

  for (const redirect of command.redirects) {
    add('update', redirect.target);
  }

  const argv = command.words;
  if (argv.length === 0) return { mutations, opaque, readOnly };
  const verb = path.basename(argv[0]);
  const args = argv.slice(1);

  if (READ_ONLY[verb] === true) return { mutations, opaque, readOnly };

  if (verb === 'sed' || verb === 'gsed' || verb === 'perl') {
    const inPlace = args.some((arg) => arg === '-i' || arg.startsWith('-i') || arg === '--in-place' || arg.startsWith('--in-place='));
    if (!inPlace) return { mutations, opaque, readOnly };
    for (const file of scriptFiles(args)) add('update', file);
    return { mutations, opaque, readOnly };
  }
  if (verb === 'awk' || verb === 'gawk') {
    const index = args.findIndex((arg) => arg === '-i' || arg === 'inplace');
    if (index === -1) return { mutations, opaque, readOnly };
    // `-i inplace` is two tokens; the program follows, then the files.
    const programAt = args[index] === '-i' && args[index + 1] === 'inplace' ? index + 2 : index + 1;
    for (const file of args.slice(programAt + 1).filter((arg) => !arg.startsWith('-'))) add('update', file);
    return { mutations, opaque, readOnly };
  }
  if (verb === 'rm' || verb === 'rmdir' || verb === 'unlink') {
    for (const file of nonFlagArgs(args)) add('delete', file);
    return { mutations, opaque, readOnly };
  }
  if (verb === 'mv') {
    const files = nonFlagArgs(args);
    if (files.length < 2) {
      opaque = true;
      return { mutations, opaque, readOnly };
    }
    const dest = files[files.length - 1];
    const sources = files.slice(0, -1);
    for (const source of sources) {
      const from = resolvePath(cwd, home, source);
      const destPath = resolvePath(cwd, home, dest);
      const to = sources.length > 1 && destPath ? path.join(destPath, path.basename(source)) : destPath;
      if (!from || !to) {
        opaque = true;
        continue;
      }
      mutations.push({ op: 'rename', path: to, from });
      readOnly = false;
    }
    return { mutations, opaque, readOnly };
  }
  if (verb === 'cp') {
    const files = nonFlagArgs(args);
    if (files.length < 2) {
      opaque = true;
      return { mutations, opaque, readOnly };
    }
    const dest = files[files.length - 1];
    const sources = files.slice(0, -1);
    for (const source of sources) {
      const destPath = resolvePath(cwd, home, dest);
      const to = sources.length > 1 && destPath ? path.join(destPath, path.basename(source)) : destPath;
      if (!to) {
        opaque = true;
        continue;
      }
      mutations.push({ op: 'update', path: to });
      readOnly = false;
    }
    return { mutations, opaque, readOnly };
  }
  if (verb === 'tee' || verb === 'touch') {
    for (const file of nonFlagArgs(args)) add('update', file);
    return { mutations, opaque, readOnly };
  }
  if (verb === 'truncate') {
    for (const file of truncateFiles(args)) add('update', file);
    return { mutations, opaque, readOnly };
  }
  if (verb === 'install' || verb === 'ln') {
    const files = nonFlagArgs(args);
    const file = files[files.length - 1];
    if (file) add(verb === 'ln' ? 'create' : 'update', file);
    else opaque = true;
    return { mutations, opaque, readOnly };
  }
  if (verb === 'dd') {
    for (const arg of args) {
      if (arg.startsWith('of=')) add('update', arg.slice(3));
    }
    return { mutations, opaque, readOnly };
  }
  if (verb === 'sort') {
    const out = flagValue(args, '-o') ?? flagValue(args, '--output');
    if (out) add('update', out);
    return { mutations, opaque, readOnly };
  }
  if (verb === 'uniq') {
    const files = nonFlagArgs(args);
    if (files.length >= 2) add('update', files[1]);
    return { mutations, opaque, readOnly };
  }
  if (verb === 'curl' || verb === 'wget') {
    const out = flagValue(args, '-o') ?? flagValue(args, '--output') ?? flagValue(args, '-O');
    if (out) add('update', out);
    return { mutations, opaque, readOnly };
  }
  if (verb === 'find') {
    const mutating = args.some((arg) => arg === '-delete' || arg === '-exec' || arg === '-execdir' || arg === '-ok' || arg === '-okdir');
    if (mutating) {
      opaque = true;
      readOnly = false;
    }
    return { mutations, opaque, readOnly };
  }
  if (verb === 'git') {
    return classifyGit(args, cwd, home, mutations, opaque, readOnly);
  }
  if (OPAQUE[verb] === true) {
    opaque = true;
    readOnly = false;
    return { mutations, opaque, readOnly };
  }

  // An unknown verb is not assumed harmless.
  opaque = true;
  readOnly = false;
  return { mutations, opaque, readOnly };
}
