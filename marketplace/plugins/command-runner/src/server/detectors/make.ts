/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The task files: `Makefile`, `justfile`, `Taskfile.yml`.
 *
 * These are the sources whose parsers carry the real difficulty, because the
 * syntax is a language rather than a document:
 *
 * - `.PHONY` and other dot-targets are not commands;
 * - `SRC := a:b` is a variable assignment that CONTAINS a colon, so a bare
 *   `^(\w+):` rule lists `SRC` as a command;
 * - a pattern rule (`%.o: %.c`) is a rule, not a runnable target;
 * - a `justfile`'s `set shell :=` is an assignment, and `[attributes]` is not a
 *   recipe.
 *
 * Every case above appears in real files and is unit-tested by name.
 */

import { field, keys, cmd, type Detector } from './types';
import type { Command } from '../../protocol';

/** A dot-target, a pattern rule or an empty name is not a command. */
const NOT_A_TARGET = /^\./;

/** `Makefile` targets: `name:` not followed by `=`, no `%` in the name. */
function parseMake(text: string): Command[] {
  const out: Command[] = [];
  const seen = new Set<string>();
  for (const raw of text.split('\n')) {
    // A continuation line belongs to the previous rule; skipping it here is what
    // keeps `foo: bar \` from listing `baz:` on the next line as its own target.
    if (raw.startsWith('\t') || raw.startsWith(' ')) continue;
    const line = raw.trimEnd();
    // `?=` `:=` `+=` `=` are assignments, whatever precedes them.
    const match = /^([A-Za-z0-9._-]+)\s*:(?!=)/.exec(line);
    if (!match) continue;
    const name = match[1];
    if (NOT_A_TARGET.test(name)) continue;
    // A pattern rule (`%.o: %.c`) is a rule, not something to run by name.
    if (name.includes('%') || line.includes('%')) continue;
    if (seen.has(name)) continue;
    seen.add(name);
    out.push(cmd(name, ['make', name]));
  }
  return out;
}

/** `justfile` recipes: `name:` (with optional args) at column zero. */
function parseJust(text: string): Command[] {
  const out: Command[] = [];
  const seen = new Set<string>();
  for (const raw of text.split('\n')) {
    // Indented lines are recipe BODIES; `[attributes]` and comments are not
    // recipes either.
    if (raw.startsWith(' ') || raw.startsWith('\t')) continue;
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('[')) continue;
    // `set shell := …` and `x := y` are assignments, not recipes.
    if (line.includes(':=')) continue;
    const match = /^@?([A-Za-z0-9_-]+)(?:\s+[^:]*)?:\s*(?:#.*)?$/.exec(line);
    if (!match) continue;
    const name = match[1];
    if (seen.has(name)) continue;
    seen.add(name);
    out.push(cmd(name, ['just', name]));
  }
  return out;
}

/** `Taskfile.yml` tasks: every key of `tasks`. */
function parseTaskfile(text: string): Command[] {
  return keys(field(Bun.YAML.parse(text), 'tasks')).map((name) => cmd(name, ['task', name]));
}

export const MAKE_DETECTORS: readonly Detector[] = [
  { kind: 'make', filenames: ['Makefile', 'makefile', 'GNUmakefile'], parse: parseMake },
  { kind: 'just', filenames: ['justfile', 'Justfile', '.justfile'], parse: parseJust },
  { kind: 'task', filenames: ['Taskfile.yml', 'Taskfile.yaml'], parse: parseTaskfile },
];
