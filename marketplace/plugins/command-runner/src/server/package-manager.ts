/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Which package manager runs a `package.json`'s scripts.
 *
 * Three sources, first hit wins, and the ORDER is the decision:
 *
 * 1. the file's own `packageManager` field (`bun@1.4.2` → `bun`) — the author's
 *    explicit statement about that directory;
 * 2. the nearest lockfile, walking UP from the file's directory to the scope
 *    root — a monorepo's root lockfile is a statement about the repository, and
 *    a nested package usually has none of its own;
 * 3. `bun`, because that is this app's own toolchain.
 *
 * (1) before (2) because a `packageManager` field is a deliberate choice while a
 * lockfile is a side effect. (3) is Bun rather than npm because a runner that
 * guessed `npm run` in a Bun repo would be wrong on the repositories this user
 * opens most.
 *
 * The result is always SHOWN on the row (`bun run dev`), so the guess is visible
 * rather than implied — a wrong guess a reader can see is a wrong guess they can
 * work around.
 */

/** The runners this knows, in the order a name is matched against a lockfile. */
export const RUNNERS = ['bun', 'npm', 'yarn', 'pnpm'] as const;
export type Runner = (typeof RUNNERS)[number];

/**
 * A lockfile's runner.
 *
 * `bun.lockb` is the pre-1.2 binary form and is still found in older checkouts;
 * `npm-shrinkwrap.json` is npm's lockfile of record in a published package.
 */
const LOCKFILE_RUNNER: Readonly<Record<string, Runner>> = {
  'bun.lock': 'bun',
  'bun.lockb': 'bun',
  'package-lock.json': 'npm',
  'npm-shrinkwrap.json': 'npm',
  'yarn.lock': 'yarn',
  'pnpm-lock.yaml': 'pnpm',
};

/** The runner a lockfile name implies, or null. */
export function runnerForLockfile(filename: string): Runner | null {
  return LOCKFILE_RUNNER[filename] ?? null;
}

/**
 * The lockfile names as PAIRS, for a caller that walks a directory tree.
 *
 * A `Record` answers "what does this name mean"; the walk asks the other
 * question — "is any lockfile here, and which" — and needs an order to test in.
 * One table, two views, so a new lockfile is added in one place.
 */
export const LOCKFILES: ReadonlyArray<readonly [string, Runner]> = [
  ['bun.lock', 'bun'],
  ['bun.lockb', 'bun'],
  ['package-lock.json', 'npm'],
  ['npm-shrinkwrap.json', 'npm'],
  ['yarn.lock', 'yarn'],
  ['pnpm-lock.yaml', 'pnpm'],
];

/**
 * The runner named by a `packageManager` field.
 *
 * npm's field is `<name>@<version>` (`bun@1.4.2`), and a bare name is accepted
 * too because a hand-written field often omits the version. Anything this does
 * not recognize returns null, so the lockfile walk decides instead of the guess
 * being wrong.
 */
export function runnerForPackageManager(field: unknown): Runner | null {
  if (typeof field !== 'string') return null;
  const name = field.split('@')[0].trim().toLowerCase();
  return (RUNNERS as readonly string[]).includes(name) ? (name as Runner) : null;
}
