/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Path and operand helpers shared by the command classifier and its `git`
 * branch.
 *
 * `resolvePath` is the security-relevant one: a glob is refused rather than
 * expanded, because the shell expands it and a guess would journal a file that
 * was never touched. The caller marks the command opaque instead.
 */

import path from 'node:path';
import type { CommandMutation } from '@/server/lib/changes/classify-command';

/** Device files a redirect may name; they are not working-tree mutations. */
const SPECIAL_FILES: Record<string, true> = {
  '/dev/null': true,
  '/dev/stdout': true,
  '/dev/stderr': true,
  '/dev/tty': true,
};

/** A device file a redirect may name; it is not a working-tree mutation. */
export function isSpecialFile(raw: string): boolean {
  return SPECIAL_FILES[raw] === true;
}

/** Resolve a shell path against the session cwd; `null` for a glob or empty. */
export function resolvePath(cwd: string, home: string, raw: string): string | null {
  if (!raw) return null;
  // A truncated command (the transcript's `…`) or an unexpanded variable
  // (`$M/$D.md`) names no real path; the command is opaque instead.
  if (raw.includes('…') || raw.includes('$')) return null;
  if (raw.includes('*') || raw.includes('?') || raw.includes('[')) return null;
  let value = raw;
  if (value === '~') value = home;
  else if (value.startsWith('~/')) value = path.join(home, value.slice(2));
  const resolved = path.isAbsolute(value) ? path.normalize(value) : path.resolve(cwd, value);
  return SPECIAL_FILES[resolved] === true ? null : resolved;
}

/** Arguments that are not flags; `--` ends flag parsing. */
export function nonFlagArgs(args: readonly string[]): string[] {
  const out: string[] = [];
  let end = false;
  for (const arg of args) {
    if (!end && arg === '--') {
      end = true;
      continue;
    }
    if (!end && arg.startsWith('-') && arg !== '-') continue;
    out.push(arg);
  }
  return out;
}

export function flagValue(args: readonly string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  const value = args[index + 1];
  return value && !value.startsWith('-') ? value : undefined;
}

/** `sed`/`perl` file operands: the script is the first non-flag argument. */
export function scriptFiles(args: readonly string[]): string[] {
  const files: string[] = [];
  let scriptSeen = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '-e' || arg === '--expression' || arg === '-f' || arg === '--file') {
      i++;
      scriptSeen = true;
      continue;
    }
    if (arg.startsWith('-')) continue;
    if (!scriptSeen) {
      scriptSeen = true;
      continue;
    }
    files.push(arg);
  }
  return files;
}

export function truncateFiles(args: readonly string[]): string[] {
  const files: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '-s' || arg === '--size' || arg === '-r' || arg === '--reference') {
      i++;
      continue;
    }
    if (arg.startsWith('-')) continue;
    files.push(arg);
  }
  return files;
}

export function dedupe(mutations: CommandMutation[]): CommandMutation[] {
  const seen = new Set<string>();
  const out: CommandMutation[] = [];
  for (const mutation of mutations) {
    const key = `${mutation.op}:${mutation.from ?? ''}:${mutation.path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(mutation);
  }
  return out;
}
