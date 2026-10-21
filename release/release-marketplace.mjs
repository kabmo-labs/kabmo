#!/usr/bin/env node
/**
 * Bump every bundled marketplace plugin whose files changed since its version
 * was last written.
 *
 * Run by the `marketplace` job of `.github/workflows/release.yml`, between
 * `packages` and `app`. **That position is the whole design**: the app job
 * fast-forwards to the commit this script makes and only then runs
 * `bun pm pack`, so the bumped manifest is inside the tarball a user installs.
 * A bump that landed after the app was packed would reach existing installs one
 * release late — the exact lag this exists to remove.
 *
 * **Why a bump is the release.** All three plugins are `private: true` and ship
 * inside the app's tarball; there is no registry for them. `syncBundledPlugins`
 * compares the installed manifest's version against the store's and applies the
 * new copy only when the store's is strictly NEWER, so the version number is the
 * entire delivery mechanism. Measured in this repository: the `stats` sticky
 * header fix and the `session-info` icon fix both shipped with their versions
 * untouched, and every install that already had the plugin kept the old files
 * forever.
 *
 * **The bump LEVEL comes from the commits**, using the same rules the app and
 * the packages use (`release/release-rules.js`), so a `fix` is a patch and a
 * `feat` is a minor. Only the bump is derived — there is no changelog, no tag
 * and no GitHub release, because none of those reach an installed plugin.
 *
 * The write is `version` in `package.json` AND `kabmo.version` in the same
 * file. They are two spellings of one number and the registry reads the second,
 * so bumping only the first would change nothing on any machine.
 *
 * usage: node release/release-marketplace.mjs [--dry-run]
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { analyzeCommits } from '@semantic-release/commit-analyzer';
import { analyzerConfig, bumpVersion, setOutput, toCommit } from './bump.js';
import { BUNDLED_PLUGINS, commitsSinceWatermark } from './marketplace.js';
import { repoRoot } from './packages.mjs';

const dryRun = process.argv.includes('--dry-run');

/**
 * Replace the two version LINES in a manifest's own text.
 *
 * A `JSON.stringify(manifest, null, 2)` round-trip is what the packages'
 * version plugin does, and it is wrong here: these manifests are hand-formatted,
 * and re-serializing expanded every inline object — measured, a two-line bump
 * came out as a 16-line diff rewriting `peerDependenciesMeta`. A release commit
 * should be the version line alone.
 *
 * Both keys are anchored by their INDENTATION (the top-level one at two spaces,
 * `kabmo.version` at four) and by the exact previous value, so nothing else
 * in the file can match. Both must be found: one alone means the file is not the
 * shape this expects, and writing it would leave the two spellings disagreeing —
 * which is precisely the drift the registry cannot see.
 *
 * @param {string} text The manifest's source.
 * @param {string} previous The version currently declared.
 * @param {string} next The version to write.
 * @returns {string}
 */
function replaceVersionLines(text, previous, next) {
  let replaced = 0;
  const out = text.replace(
    new RegExp(`^(\\s{2,4})"version": ${JSON.stringify(previous)},$`, 'gm'),
    (_match, indent) => {
      replaced += 1;
      return `${indent}"version": ${JSON.stringify(next)},`;
    },
  );

  if (replaced !== 2) {
    throw new Error(
      `expected to rewrite 2 version lines, rewrote ${replaced}; refusing to write a partial bump`,
    );
  }

  return out;
}

const outcomes = [];
let failed = false;

for (const entry of BUNDLED_PLUGINS) {
  const path = join(repoRoot, entry.dir, 'package.json');

  try {
    const source = readFileSync(path, 'utf8');
    const manifest = JSON.parse(source);
    const declared = manifest.kabmo?.version;

    // The two spellings must agree before anything is written, or a bump would
    // silently correct (or widen) a drift that is the author's to fix.
    if (!manifest.version || !declared) {
      throw new Error(`${entry.dir}/package.json has no version or no kabmo.version`);
    }
    if (manifest.version !== declared) {
      throw new Error(
        `${entry.dir}/package.json declares version ${manifest.version} but kabmo.version ${declared}; they must agree`,
      );
    }

    const commits = commitsSinceWatermark(entry.dir, repoRoot);
    if (commits.length === 0) {
      outcomes.push({ entry, status: 'unchanged', from: manifest.version });
      continue;
    }

    const type = await analyzeCommits(analyzerConfig, {
      commits: commits.map(toCommit),
      cwd: repoRoot,
      options: {},
      logger: { log() {} },
    });

    // A range of `chore`/`docs`/`test` commits asks for no version at all. That
    // is a real answer: a plugin whose only change was a test file has nothing
    // for an installed copy to receive, so bumping would ship a no-op update to
    // every user for nothing.
    if (!type) {
      outcomes.push({ entry, status: 'no-bump', from: manifest.version, commits: commits.length });
      continue;
    }

    const next = bumpVersion(manifest.version, type);

    if (!dryRun) {
      writeFileSync(path, replaceVersionLines(source, manifest.version, next));
    }

    outcomes.push({ entry, status: 'bumped', from: manifest.version, next, type, commits: commits.length });
  } catch (error) {
    failed = true;
    outcomes.push({ entry, status: 'failed', reason: error.message });
  }
}

for (const outcome of outcomes) {
  const { entry } = outcome;

  if (outcome.status === 'bumped') {
    console.log(`${entry.id}: ${outcome.from} -> ${outcome.next} (${outcome.type}, ${outcome.commits} commit(s))`);
  } else if (outcome.status === 'unchanged') {
    console.log(`${entry.id}: unchanged at ${outcome.from} (no commits since it was written)`);
  } else if (outcome.status === 'no-bump') {
    console.log(`${entry.id}: unchanged at ${outcome.from} (${outcome.commits} commit(s), none asks for a version bump)`);
  } else {
    console.error(`${entry.id}: FAILED — ${outcome.reason}`);
  }
}

const bumped = outcomes.filter((outcome) => outcome.status === 'bumped').map((outcome) => outcome.entry.dir);

setOutput('bumped', bumped.join(' '));
setOutput('any', bumped.length > 0 ? 'true' : 'false');

if (failed) {
  process.exit(1);
}

if (bumped.length === 0) {
  console.log('No plugin bump: nothing since the last version write asks for one.');
} else if (dryRun) {
  console.log(`Dry run: would bump ${bumped.join(', ')}`);
}
