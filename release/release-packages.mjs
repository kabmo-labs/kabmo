#!/usr/bin/env node
/**
 * Cut a release for every published package that has changes — with ONE commit
 * and ONE atomic push for the whole set.
 *
 * Run by the `packages` job of `.github/workflows/release.yml` on a push to
 * `main`, BEFORE that workflow's `app` job — the app's published
 * `@kabmo-labs/*` pins come from `bun.lock`, so the packages must be versioned
 * and the lock committed before the app releases.
 *
 * **What changed, and why.** Each package used to be a full semantic-release
 * run, `@semantic-release/git` included: its `prepare` step added that
 * package's assets, committed them and PUSHED, and core then tagged that commit
 * and `@semantic-release/github` created its release page. A run where both
 * packages released therefore left TWO commits and TWO pushes for ONE decision
 * to release. The git work is now this script's, once:
 *
 *   1. every package is decided AND written by semantic-release with
 *      `dryRun: true` (its own switch for "decide and write, do not tag or
 *      publish") and with the git/github plugins removed from the config;
 *   2. `release/packages-commit.js` stages every asset, commits ONCE, creates
 *      both tags at that commit, and pushes the branch with its tags
 *      `--atomic`;
 *   3. one release page per tag, with the notes semantic-release generated.
 *
 * The failure shape is also deliberate: each package is released from the SAME
 * commit range and the same rules as the app (`release/packages.mjs` narrows the
 * range to the package's own commits), releases run in catalog order and stop on
 * the first failure, and nothing is committed unless every package that was
 * going to release succeeded. `@kabmo-labs/kabmo-ui` pins the SDK version at pack
 * time, so publishing a `ui` whose SDK dependency is not on npm is worse than
 * publishing neither.
 *
 * **The tags this creates do NOT trigger `publish-plugins.yml`.** A push made
 * with `GITHUB_TOKEN` raises no workflow run (only `workflow_dispatch` and
 * `repository_dispatch` are exempt — see "Triggering a workflow" in the Actions
 * docs), which is the same reason `release.yml` calls the publish body itself.
 * This script therefore only cuts the release; the workflow publishes what its
 * `released` output names.
 *
 * usage: node release/release-packages.mjs [--dry-run]
 */

import { appendFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import semanticRelease from 'semantic-release';
import { RELEASE_PACKAGES, assertReleaseEnvironment } from './packages.js';
import { packageReleaseConfig, packageVersion, repoRoot, writePackageRelease } from './packages.mjs';
import { commitRelease, createGithubReleases } from './packages-commit.js';

const dryRun = process.argv.includes('--dry-run');

// A `--dry-run` writes nothing and pushes nothing, so it needs no guard.
// Everything else is refused outside CI — see the note in `packages.js`.
if (!dryRun) {
  assertReleaseEnvironment(process.env);
}

/** Write a `key=value` line for the workflow step that reads it. */
function setOutput(key, value) {
  const file = process.env.GITHUB_OUTPUT;

  if (file) {
    appendFileSync(file, `${key}=${value}\n`);
  }
}

/** @type {Array<{entry: object, before: string, status: string, after?: string, tag?: string, type?: string, reason?: string}>} */
const outcomes = [];
/** @type {Array<{entry: object, before: string, version: string, tag: string, notes?: string}>} */
const released = [];
let failed = false;

for (const entry of RELEASE_PACKAGES) {
  const before = packageVersion(entry.dir);

  try {
    // `dryRun: true` is semantic-release's ANALYSIS mode: it verifies, analyzes
    // the commits and generates the notes, and skips `prepare`/`publish` — which
    // is why the writes below are explicit. Nothing here reaches the git plugins,
    // because the config carries none: the commit and the tags are this script's.
    const config = packageReleaseConfig(entry);
    const result = await semanticRelease({ ...config, dryRun: true }, { cwd: repoRoot, env: process.env });

    if (!result?.nextRelease) {
      outcomes.push({ entry, before, status: 'unchanged' });
      continue;
    }

    const { version, gitTag, notes, type } = result.nextRelease;

    // The working tree is written HERE, one package at a time and in catalog
    // order, so a dependent package sees its dependency's new version in the
    // lockfile the version plugin refreshes.
    await writePackageRelease({ entry, nextRelease: result.nextRelease, cwd: repoRoot, write: !dryRun });

    released.push({ entry, before, version, tag: gitTag, notes });
    outcomes.push({ entry, before, status: 'released', after: version, tag: gitTag, type });
  } catch (error) {
    // Stop here rather than continuing to the next package: the catalog is
    // ordered so a dependent package is released after what it depends on.
    failed = true;
    outcomes.push({ entry, before, status: 'failed', reason: error.message });
    break;
  }
}

if (!failed && released.length > 0 && !dryRun) {
  try {
    const committed = commitRelease({
      released,
      git: (args) => execFileSync('git', args, { cwd: repoRoot, stdio: 'inherit' }),
      // Relative to the REPOSITORY the git commands run in, never to whatever
      // directory the process happens to have been started from.
      exists: (asset) => existsSync(join(repoRoot, asset)),
    });

    console.log(`committed ${released.length} package release(s): ${committed.message}`);

    const created = await createGithubReleases({
      released,
      token: process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN,
      repository: process.env.GITHUB_REPOSITORY,
      fetchImpl: fetch,
    });

    if (created.length > 0) {
      console.log(`release page(s): ${created.join(', ')}`);
    }
  } catch (error) {
    failed = true;
    console.error(`release FAILED — ${error.message}`);
  }
}

for (const outcome of outcomes) {
  const { entry } = outcome;

  if (outcome.status === 'released') {
    console.log(`${entry.name}: ${outcome.before} -> ${outcome.after} (${outcome.type}), tag ${outcome.tag}`);
  } else if (outcome.status === 'unchanged') {
    console.log(`${entry.name}: no release (still ${outcome.before})`);
  } else {
    console.error(`${entry.name}: FAILED — ${outcome.reason}`);
  }
}

// A failed run publishes an empty answer: its step fails, so the workflow never
// publishes, and a name here would claim a release `main` never received.
const releasedDirs = failed ? [] : outcomes.filter((outcome) => outcome.status === 'released').map((outcome) => outcome.entry.dir);

setOutput('released', releasedDirs.join(' '));
setOutput('any', releasedDirs.length > 0 ? 'true' : 'false');

if (failed) {
  process.exit(1);
}

if (releasedDirs.length === 0) {
  console.log('No package release: nothing since the last package tag asks for a version bump.');
} else if (dryRun) {
  console.log(`Dry run: would release ${releasedDirs.join(', ')}`);
}
