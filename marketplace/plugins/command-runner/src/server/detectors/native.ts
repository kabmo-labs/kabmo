/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Go, Rust, PHP, Java and Elixir.
 *
 * Five ecosystems with five different answers to "where are the commands", and
 * the differences are why each is its own detector rather than one generic "look
 * for a build file":
 *
 * - **Go** has no task file at all. `go.mod` proves the toolchain and the
 *   commands are the `cmd/<name>` PACKAGES beside it, which is why this is the
 *   only detector that reads a directory.
 * - **Rust** is `cargo`'s own verbs plus the `[[bin]]` targets in `Cargo.toml`;
 *   a project's own command NAMES live in `.cargo/config.toml`'s `[alias]`, which
 *   is a second file and therefore a second row.
 * - **PHP** is `composer.json`'s `scripts` plus Laravel's `artisan`, whose
 *   commands are knowable only by running it.
 * - **Java** is the Gradle or Maven wrapper, and the WRAPPER is what is read: a
 *   repository that ships `./gradlew` wants that, not whatever `gradle` the
 *   machine happens to have.
 * - **Elixir** is `mix.exs`'s own `aliases`, which is where a project declares
 *   its commands.
 */

import { join } from 'node:path';

import { at, field, keys, cmd, standardVerbs, type Detector, type DetectorContext } from './types';
import { parseJsonc } from './jsonc';
import type { Command } from '../../protocol';

/** `cargo`'s stable verbs. */
const CARGO_VERBS = ['build', 'run', 'test', 'check', 'clippy', 'fmt', 'bench', 'doc'] as const;
/** Laravel's `artisan` verbs: the framework's own stable set. */
const ARTISAN_VERBS = [
  'serve',
  'migrate',
  'migrate:fresh',
  'db:seed',
  'make:model',
  'make:controller',
  'make:migration',
  'test',
  'queue:work',
  'tinker',
  'route:list',
] as const;
/** Gradle's stable tasks. */
const GRADLE_VERBS = ['build', 'test', 'run', 'clean', 'check', 'assemble', 'publish'] as const;
/** Maven's. */
const MAVEN_VERBS = ['compile', 'test', 'package', 'verify', 'install', 'clean', 'deploy'] as const;

/**
 * `go.mod`: the `cmd/<name>` packages beside it.
 *
 * A `main` package at the module ROOT is the other common shape and is a command
 * too, but naming it needs each `.go` file read for `package main` — a parser for
 * the language rather than a table row. The directory convention is what Go's own
 * tooling documents, so that is what is read; the root is offered only alongside
 * a `cmd/`, because a module with no `cmd/` is usually a library.
 */
function parseGo(text: string, ctx: DetectorContext): Command[] {
  const moduleName = /^\s*module\s+(\S+)/m.exec(text)?.[1]?.split('/').pop() ?? '';
  const names = ctx.dirs(join(ctx.dir, 'cmd'));
  const out = names.map((name) => cmd(name, ['go', 'run', `./cmd/${name}`]));
  if (names.length > 0 && moduleName) out.push(cmd(`run ${moduleName}`, ['go', 'run', '.']));
  return out;
}

/** `Cargo.toml`: cargo's verbs, plus every `[[bin]]` target. */
function parseCargo(text: string): Command[] {
  const out = standardVerbs(['cargo'], CARGO_VERBS);
  const bins = at(Bun.TOML.parse(text), ['bin']);
  if (!Array.isArray(bins)) return out;
  for (const entry of bins) {
    const name = field(entry, 'name');
    // `cargo run --bin <name>` — the project's OWN command name, so it is a row.
    if (typeof name === 'string' && name) out.push(cmd(name, ['cargo', 'run', '--bin', name]));
  }
  return out;
}

/** `.cargo/config.toml`: the `[alias]` table, which is a project's own verbs. */
function parseCargoConfig(text: string): Command[] {
  return keys(at(Bun.TOML.parse(text), ['alias'])).map((name) => cmd(name, ['cargo', name]));
}

/** `composer.json` scripts, plus `artisan` when this is a Laravel app. */
function parseComposer(text: string, ctx: DetectorContext): Command[] {
  const out = keys(field(parseJsonc(text), 'scripts')).map((name) => cmd(name, ['composer', 'run-script', name]));
  // Laravel is recognised by the file that IS the app's entry point.
  if (ctx.entries(ctx.dir).includes('artisan')) out.push(...standardVerbs(['php', 'artisan'], ARTISAN_VERBS));
  return out;
}

/** `artisan` alone, for an app whose `composer.json` declares no scripts. */
function parseArtisan(): Command[] {
  return standardVerbs(['php', 'artisan'], ARTISAN_VERBS);
}

/**
 * `build.gradle` / `pom.xml`: the project's own WRAPPER when it ships one.
 *
 * A repository that commits `./gradlew` wants the wrapper — it pins the Gradle
 * version the build was written for — so the script's presence decides the
 * prefix rather than the machine's PATH.
 */
function gradleCommands(text: string, ctx: DetectorContext, kind: 'gradle' | 'maven'): Command[] {
  const wrapper = kind === 'gradle' ? 'gradlew' : 'mvnw';
  const hasWrapper = ctx.entries(ctx.dir).includes(wrapper);
  const prefix = hasWrapper ? [`./${wrapper}`] : [kind === 'gradle' ? 'gradle' : 'mvn'];

  if (kind === 'maven') return standardVerbs(prefix, MAVEN_VERBS);

  // Gradle's own tasks are declared in the build script, but reading them
  // honestly means RUNNING gradle. The stable set is listed instead, and the
  // label names the wrapper so the row runs the pinned version. A `task <name>`
  // declaration is still read, because it is a name the file itself states.
  const declared = [...text.matchAll(/^\s*task\s+([A-Za-z0-9_-]+)/gm)].map((match) => match[1]!);
  return [...standardVerbs(prefix, GRADLE_VERBS), ...declared.map((name) => cmd(name, [...prefix, name]))];
}

/** `mix.exs`: the project's own `aliases`. */
function parseMix(text: string): Command[] {
  // The file is ELIXIR CODE, so this is a regex over the `aliases do … end`
  // block rather than an evaluation: reading a list of names is not worth
  // executing a project's code for.
  const block = /aliases\s+do([\s\S]*?)\n\s*end/.exec(text)?.[1];
  if (!block) return [];
  const out: Command[] = [];
  for (const match of block.matchAll(/^\s*"?([A-Za-z0-9_.:]+)"?\s*:/gm)) {
    out.push(cmd(match[1]!, ['mix', match[1]!]));
  }
  return out;
}

export const NATIVE_DETECTORS: readonly Detector[] = [
  { kind: 'go', filenames: ['go.mod'], parse: parseGo },
  { kind: 'rust', filenames: ['Cargo.toml'], parse: parseCargo },
  // A SUFFIX match: `config.toml` alone is far too common a name to claim.
  { kind: 'rust', filenames: [], paths: ['.cargo/config.toml'], parse: parseCargoConfig },
  { kind: 'php', filenames: ['composer.json'], parse: parseComposer },
  { kind: 'php', filenames: ['artisan'], parse: parseArtisan },
  {
    kind: 'java',
    filenames: ['build.gradle', 'build.gradle.kts'],
    parse: (text, ctx) => gradleCommands(text, ctx, 'gradle'),
  },
  { kind: 'java', filenames: ['pom.xml'], parse: (text, ctx) => gradleCommands(text, ctx, 'maven') },
  { kind: 'elixir', filenames: ['mix.exs'], parse: parseMix },
];
