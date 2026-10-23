/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Branch naming and slugging for worktrees — ONE module, because the dialog and
 * the create route must agree on what a name means. The dialog pre-fills the
 * branch and derives the folder; the server re-derives both from what arrives.
 *
 * The word lists are OpenChamber's Ubuntu-style pairs (their
 * `lib/git/branchNameGenerator.ts`), and the pick is seeded from
 * `crypto.getRandomValues` rather than `Math.random`, which is available in the
 * browser and in Bun without an import.
 */

/**
 * Kabmo's namespace for a generated worktree branch. Deliberately `wt`, not
 * OpenChamber's `openchamber`: omp's own `/wt` already creates `wt/*`, so a
 * repository that has used either tool reads one convention instead of two.
 */
export const WORKTREE_BRANCH_PREFIX = 'wt';

const ADJECTIVES = [
  'artful', 'bionic', 'cosmic', 'disco', 'focal', 'groovy', 'jammy', 'kinetic',
  'lunar', 'noble', 'bold', 'brave', 'calm', 'eager', 'gentle', 'happy', 'keen',
  'lively', 'merry', 'swift', 'warm', 'wise', 'bright', 'clever', 'daring',
  'agile', 'crisp', 'fresh', 'lucid', 'quick', 'sharp', 'vivid', 'zealous',
];

const NOUNS = [
  'aardvark', 'beaver', 'chipmunk', 'dolphin', 'falcon', 'gopher', 'hedgehog',
  'jackal', 'koala', 'lemur', 'mongoose', 'narwhal', 'otter', 'pangolin',
  'quokka', 'raccoon', 'salamander', 'toucan', 'walrus', 'yak', 'zebra',
  'badger', 'condor', 'dingo', 'egret', 'ferret', 'gecko', 'heron', 'iguana',
];

/** A random index from the platform CSPRNG, so two sessions rarely collide. */
function pick(values: readonly string[]): string {
  const bytes = new Uint8Array(2);
  crypto.getRandomValues(bytes);
  return values[((bytes[0] ?? 0) << 8 | (bytes[1] ?? 0)) % values.length] as string;
}

/** One adjective-noun pair, e.g. `cosmic-dolphin`. */
export function generateBranchSlug(): string {
  return `${pick(ADJECTIVES)}-${pick(NOUNS)}`;
}

/** The default branch of a worktree: our namespace plus a generated slug. */
export function defaultWorktreeBranch(): string {
  return `${WORKTREE_BRANCH_PREFIX}/${generateBranchSlug()}`;
}

/** The branch as git names it, without the ref namespace. */
export function normalizeBranchName(value: string): string {
  return String(value ?? '')
    .trim()
    .replace(/^refs\/heads\//, '')
    .replace(/^heads\//, '')
    .replace(/\s+/g, '-')
    .replace(/^\/+|\/+$/g, '');
}

/**
 * One path segment, ≤80 chars, safe on every filesystem we target.
 *
 * A leading `.` is stripped and the dot-only results are rejected: `slug('.')`
 * is `.` and `slug('..')` is `..`, and `path.join(root, name)` resolves those to
 * the root itself and to its parent. A folder name that escapes its root is not
 * a name.
 */
export function slugWorktreeName(value: string): string {
  const slug = String(value ?? '')
    .trim()
    .replace(/^refs\/heads\//, '')
    .replace(/^heads\//, '')
    .replace(/\s+/g, '-')
    .replace(/^\/+|\/+$/g, '')
    .split('/')
    .join('-')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '')
    .slice(0, 80);
  return slug === '.' || slug === '..' ? '' : slug;
}

/**
 * The folder a branch gets. Our own `wt/` namespace is stripped — the folder
 * does not repeat it — while a repository's own namespaces stay visible
 * (`feat/x` → `feat-x`). A non-Latin branch (`测试分支`) leaves no slug, and the
 * caller falls back to a generated name rather than an empty folder.
 */
export function folderNameForBranch(branch: string): string {
  const withoutRef = normalizeBranchName(branch);
  const namespaced = `${WORKTREE_BRANCH_PREFIX}/`;
  const withoutOwnPrefix = withoutRef.startsWith(namespaced)
    ? withoutRef.slice(namespaced.length)
    : withoutRef;
  return slugWorktreeName(withoutOwnPrefix);
}

/**
 * Whether git would plausibly accept this as a branch name. Rejects only what
 * `git check-ref-format` rejects in every case — the server still asks git
 * itself, because a plausible name can still collide with an existing ref.
 */
export function isPlausibleBranchName(value: string): boolean {
  if (!value) return false;
  if (/^[.\-/]/.test(value) || /[/.]$/.test(value)) return false;
  if (value.includes('..') || value.includes('//') || value.includes('@{')) return false;
  if (/[\s~^:?*[\\]/.test(value)) return false;
  return true;
}