/**
 * Which commits the APP release is decided from.
 *
 * The app has no per-artifact tag, so its range is every commit since the last
 * `v*` tag — and that range contains work belonging to artifacts with a release
 * channel of their own. The Android shell is the one that matters:
 * `release/release-android.mjs` bumps `version.properties` from the shell's own
 * commits and the `shell-release` job publishes an APK for them. Without a
 * scope, a `fix(android): …` push would ALSO cut an app version, tag it and
 * publish it to npm.
 *
 * **The test is not "did this commit stay inside `packages/android`".** Measured
 * on this repository's own history, it does not: shell commits routinely carry
 * `AGENTS.md`, `packages/android/README.md`, `release/` and
 * `.github/workflows/` beside their Kotlin, because the notes, the bump script
 * and the APK body are part of the same change. Of the nine shell commits in
 * `v0.0.1..HEAD`, only the bump commit itself touched nothing else — the other
 * eight would have kept cutting app versions.
 *
 * So the question asked here is the one that actually decides whether an app
 * release means anything: **does this commit change bytes a user receives from
 * the app's own tarball?** A commit is dropped only when it touches an
 * independent artifact AND touches nothing in the app's shipped surface. That
 * keeps the case that must not be dropped — a `feat(android)` that also fixes
 * the console's APK probe in `src/` — and drops the documentation, workflow and
 * release-tooling edits that ride along with a shell change.
 *
 * Two rules are shared with `scopeCommits` (`release/packages.mjs`) and are
 * load-bearing in both directions:
 *
 * - A commit with NO paths — a merge, an empty commit, a `revert` git recorded
 *   without a diff — is KEPT. Dropping it would drop a revert.
 * - The path lookup is one `git diff-tree --stdin` over the whole range, never
 *   one `git log` per commit (see `release/commits.js`).
 */

import { analyzeCommits as analyzeCommitsStep } from '@semantic-release/commit-analyzer';
import { generateNotes as generateNotesStep } from '@semantic-release/release-notes-generator';
import { filesForCommits } from './commits.js';

/**
 * Directories (or root files) whose commits belong to a release channel of
 * their own.
 *
 * `packages/android` only, and the reason the two published packages are NOT
 * here is the chain in `release.yml`: the app's npm tarball pins
 * `@kabmo-labs/*` from `bun.lock`, so a package release must be followed by an
 * app release or the app keeps publishing the previous pin.
 *
 * A bundled marketplace plugin is deliberately not here either: it is delivered
 * inside the app's own tarball, so the app version IS its release vehicle —
 * excluding it would bump a number in this repository that no installed copy
 * ever receives.
 */
export const APP_INDEPENDENT_TREES = ['packages/android'];

/**
 * What the app actually ships, and what builds it.
 *
 * A path in this list makes a commit an app commit. It is the `files` field of
 * `package.json` plus `scripts/` (which produces the bundle the tarball carries)
 * and `bun.lock` (the dependency pins, substituted at publish time).
 *
 * Deliberately absent: `tests/`, `docs/`, `AGENTS.md` and `.github/`. They are
 * real work, but a release of the app is not how they reach anybody — and their
 * commit TYPES (`test`, `docs`, `ci`) already release nothing on their own
 * (`release/release-rules.js`).
 */
export const APP_SURFACE = [
  'src',
  'extensions',
  'index.html',
  'bunfig.toml',
  'public',
  'tsconfig.json',
  'marketplace',
  'scripts',
  'package.json',
  'bun.lock',
];

/** Whether a repository-relative path sits inside a tree (or is its root file). */
function inTree(path, dir) {
  return path === dir || path.startsWith(`${dir}/`);
}

const inAny = (path, trees) => trees.some((dir) => inTree(path, dir));

/**
 * The commits an app release should be decided from.
 *
 * @param {Array<{hash: string}>} commits The range semantic-release collected.
 * @param {string} cwd The repository the commits came from — `context.cwd`, not
 *   a path derived from this module, for the reason `scopeCommits` documents.
 * @returns {Array<object>}
 */
export function scopeAppCommits(commits, cwd) {
  if (commits.length === 0) {
    return commits;
  }

  const files = filesForCommits(
    commits.map((commit) => commit.hash),
    cwd,
  );

  return commits.filter((commit) => {
    const paths = files.get(commit.hash) ?? [];

    // No paths at all: a merge or an empty commit. Kept, exactly as
    // `scopeCommits` keeps it.
    if (paths.length === 0) {
      return true;
    }

    // Dropped only when it belongs to another artifact's channel AND changes
    // nothing the app ships. One shipped path makes it an app commit.
    return !(paths.some((path) => inAny(path, APP_INDEPENDENT_TREES)) && !paths.some((path) => inAny(path, APP_SURFACE)));
  });
}

/**
 * The app's commit-analyzer step, reading only commits that belong to the app.
 *
 * @returns {(pluginConfig: object, context: object) => Promise<string|null>}
 */
export function scopedAnalyzeAppCommits() {
  return (pluginConfig, context) =>
    analyzeCommitsStep(pluginConfig, {
      ...context,
      commits: scopeAppCommits(context.commits, context.cwd),
    });
}

/**
 * The app's notes-generator step, over the same scoped range.
 *
 * The changelog is written from this, so a shell-only push produces no app
 * section at all rather than an app release whose notes list shell fixes.
 *
 * @returns {(pluginConfig: object, context: object) => Promise<string>}
 */
export function scopedGenerateAppNotes() {
  return (pluginConfig, context) =>
    generateNotesStep(pluginConfig, {
      ...context,
      commits: scopeAppCommits(context.commits, context.cwd),
    });
}
