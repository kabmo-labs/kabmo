#!/usr/bin/env node
/**
 * Cut a release for every published package that has changes.
 *
 * Run by the `packages` job of `.github/workflows/release.yml` on a push to
 * `main`, BEFORE that workflow's `app` job — the app's published
 * `@kabmo-labs/*` pins come from `bun.lock`, so the packages must be versioned
 * and the lock committed before the app releases.
 *
 * Each package is released from the SAME commit range and the same rules as the
 * app (see `release/packages.mjs` for the per-package config, which narrows the
 * range to the package's own commits). Releases run in catalog order and stop
 * on the first failure, because `@kabmo-labs/kabmo-ui` pins the SDK version at pack
 * time: publishing a `ui` whose SDK dependency is not on npm is worse than
 * publishing neither.
 *
 * **The tags this creates do NOT trigger `publish-plugins.yml`.** A push made
 * with `GITHUB_TOKEN` raises no workflow run (only `workflow_dispatch` and
 * `repository_dispatch` are exempt — see "Triggering a workflow" in the Actions
 * docs), which is the same reason `release.yml` dispatches `publish.yml`
 * itself. This script therefore only cuts the release; the workflow dispatches
 * the publish afterwards, for the packages it names in its `released` output.
 *
 * usage: node release/release-packages.mjs [--dry-run]
 */

import { appendFileSync } from 'node:fs';
import semanticRelease from 'semantic-release';
import { RELEASE_PACKAGES, assertReleaseEnvironment } from './packages.js';
import { packageReleaseConfig, packageVersion, repoRoot } from './packages.mjs';

const dryRun = process.argv.includes('--dry-run');

// A `--dry-run` never reaches a `prepare` step, so it pushes nothing and needs
// no guard. Everything else is refused outside CI — see the note above.
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
let failed = false;

for (const entry of RELEASE_PACKAGES) {
  const before = packageVersion(entry.dir);

  try {
    const config = packageReleaseConfig(entry);

    // A local `--dry-run` has no token, and the GitHub plugin refuses to verify
    // without one. Dropping it is exactly what the rehearsal recipe in
    // release.yml tells a maintainer to do by hand; doing it here is what makes
    // `--dry-run` a rehearsal that works. In CI a token is always present, so
    // the plugin stays and the release and its notes are created.
    if (dryRun && !process.env.GITHUB_TOKEN && !process.env.GH_TOKEN) {
      config.plugins = config.plugins.filter((plugin) => plugin !== '@semantic-release/github');
    }

    const result = await semanticRelease(
      { ...config, dryRun },
      { cwd: repoRoot, env: process.env },
    );

    if (!result) {
      outcomes.push({ entry, before, status: 'unchanged' });
      continue;
    }

    outcomes.push({
      entry,
      before,
      status: 'released',
      after: result.nextRelease.version,
      tag: result.nextRelease.gitTag,
      type: result.nextRelease.type,
    });
  } catch (error) {
    // Stop here rather than continuing to the next package: the catalog is
    // ordered so a dependent package is released after what it depends on.
    failed = true;
    outcomes.push({ entry, before, status: 'failed', reason: error.message });
    break;
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

const released = outcomes.filter((outcome) => outcome.status === 'released').map((outcome) => outcome.entry.dir);

setOutput('released', released.join(' '));
setOutput('any', released.length > 0 ? 'true' : 'false');

if (failed) {
  process.exit(1);
}

if (released.length === 0) {
  console.log('No package release: nothing since the last package tag asks for a version bump.');
} else if (dryRun) {
  console.log(`Dry run: would dispatch a publish for ${released.join(', ')}`);
}
