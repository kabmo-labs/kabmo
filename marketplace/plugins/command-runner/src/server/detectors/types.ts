/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * What a detector IS, the readers every parser shares, and the one helper that
 * builds a command.
 *
 * ## The detector owns its argv, and the label is DERIVED from it
 *
 * A detector knows the tool its file belongs to, so it builds the argv; the label
 * is `argv.join(' ')` and nothing else. That invariant is the point: the label is
 * what the row shows and the argv is what runs, so two functions deriving them
 * from the same `kind` can disagree — and a row that says `npm run dev` while
 * running `bun run dev` is a lie the reader cannot see. There is now no way to
 * state one without the other.
 *
 * ## Why `parse` takes a context
 *
 * Two sources need more than the file's text, and neither is a corner case:
 *
 * - **`go.mod`** lists no commands at all — the commands are the `cmd/<name>`
 *   DIRECTORIES beside it, so the detector has to read the directory.
 * - **`package.json`** needs the resolved package runner, which is decided by a
 *   lockfile walk that only `scan.ts` can do.
 *
 * Both arrive through `DetectorContext` rather than by widening `parse`'s
 * arguments one at a time, so a third need is a field rather than a signature
 * change across every detector.
 *
 * ## The readers narrow, they never assert
 *
 * Every file this table reads is EXTERNAL data — a JSON, TOML or YAML document
 * written by somebody else — so a shape is never asserted. `field`/`keys`/`at`
 * are real runtime reads (`Reflect.get`, `Object.keys`) that answer `undefined`
 * or `[]` for a shape that is not there, which is what makes a malformed file a
 * short list rather than a crash.
 */

import type { Command, CommandKind } from '../../protocol';

/** Everything a detector may read beyond the file's own text. */
export interface DetectorContext {
  /** Absolute path of the file being parsed. */
  file: string;
  /** The directory the file lives in. */
  dir: string;
  /**
   * Entry names of an absolute directory, or `[]` when it cannot be read.
   *
   * Memoized by the caller: a detector that reads `cmd/` twice in one scan must
   * not pay for two reads.
   */
  entries(dir: string): string[];
  /** Only the DIRECTORIES of an absolute path, or `[]`. Memoized with `entries`. */
  dirs(dir: string): string[];
  /**
   * The resolved package runner, for a detector that declares `needsRunner`.
   *
   * `undefined` for every other detector, so a runner that was never resolved
   * cannot be mistaken for one that was.
   */
  runner?: string;
}

/** One row of the table: a command SOURCE. */
export interface Detector {
  kind: CommandKind;
  /** The filenames this source uses, matched on the BASENAME. */
  filenames: readonly string[];
  /**
   * Paths matched as a SUFFIX of the file's repo-relative path, for a file whose
   * basename is not distinctive.
   *
   * `.cargo/config.toml` is the case this exists for: `config.toml` is a very
   * common name, and matching it on the basename alone would claim an unrelated
   * file in every project that happens to have one.
   */
  paths?: readonly string[];
  /**
   * This source's commands run through the resolved package runner.
   *
   * A FLAG rather than a `kind === 'package'` test at the call site: the runner
   * walk lives in `scan.ts` and would otherwise have to know which kinds want it,
   * which is the same branch-in-two-places problem the table exists to remove.
   */
  needsRunner?: boolean;
  /**
   * Read the file into commands.
   *
   * Throws for a file that cannot be read as its own format — `scan.ts` turns
   * that into the group's `error`, because "no commands" and "this file would not
   * parse" are different answers and a user can only act on the second.
   */
  parse(text: string, ctx: DetectorContext): Command[];
}

/** Read one property of an unknown value, or `undefined`. */
export function field(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null ? Reflect.get(value, key) : undefined;
}

/** The keys of an unknown object, or `[]` when it is not one. */
export function keys(value: unknown): string[] {
  return typeof value === 'object' && value !== null ? Object.keys(value) : [];
}

/** Follow a path of properties, answering `undefined` at the first gap. */
export function at(value: unknown, path: readonly string[]): unknown {
  let node: unknown = value;
  for (const key of path) {
    node = field(node, key);
    if (node === undefined) return undefined;
  }
  return node;
}

/**
 * One command, with its label derived from its argv.
 *
 * `name` is what the command is CALLED in its own source (`dev`, `build`, `web`,
 * `py311`) — it is the id's tail and the row's identity, and it is deliberately
 * not always the last argv element (`cargo run --bin foo` runs `foo`).
 */
export function cmd(name: string, argv: string[]): Command {
  return { id: '', name, label: argv.join(' '), argv };
}

/**
 * The standard verbs of a toolchain whose command list is only knowable at
 * runtime.
 *
 * `Cargo.toml`, `go.mod`, `artisan` and `manage.py` are all files that PROVE a
 * toolchain is present while declaring no runnable commands of their own — cargo
 * and go have no task file, and `artisan`/`manage.py` answer their command list
 * only when executed. Listing their stable, universal verbs is the useful answer
 * and the honest one, as long as it is stated: these are the tool's OWN verbs,
 * not something discovered in the file, and the row's label says exactly what
 * will run.
 *
 * Kept deliberately short. A verb that is not near-universal does not belong
 * here — a curated list that is wrong is worse than a short one.
 */
export function standardVerbs(prefix: readonly string[], verbs: readonly string[]): Command[] {
  return verbs.map((verb) => cmd(verb, [...prefix, verb]));
}
