#!/usr/bin/env node
/**
 * Bump the macOS shell's version when `packages/macos` changed since that version
 * was last written.
 *
 * Run by the `macos` job of `.github/workflows/release.yml`, between `ios` and
 * `macos-build`. **That position is the whole design**: the `.app` is assembled
 * BEFORE the app tags, from `main` — the branch this commit lands on — so the
 * bump is inside the tree the artifact is built from, and `publish-macos.yml`
 * reads `versionName` out of that checkout rather than out of the app's tag.
 * Building the run's STARTING commit would declare the previous shell version.
 *
 * **Why a bump is the release.** The `.app` is not published to any registry
 * (`packages/macos` is a private application), so the version it declares is the
 * entire delivery mechanism: it is what the bundle's `CFBundleShortVersionString`
 * says, what the asset name carries, and what a person reads to know whether the
 * build they downloaded is newer than the one they have.
 *
 * Unlike its Android and iOS siblings there is no User-Agent token: those two are
 * downloaded from the console, which compares the published asset's version
 * against the running shell's, so their number is parsed on every request. A
 * macOS app is installed by a person from the release page — nothing in the
 * console offers it — so nothing parses it. The bump still matters, because the
 * plist and the asset name have to agree and both have to move.
 *
 * **The bump LEVEL comes from the commits**, using the same rules the app, the
 * packages and the plugins use (`release/release-rules.js`), so a `fix` is a
 * patch and a `feat` is a minor. Only the bump is derived — there is no
 * changelog and no tag of its own, because neither reaches an installed app.
 *
 * usage: node release/release-macos.mjs [--dry-run]
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { analyzeCommits } from '@semantic-release/commit-analyzer';
import { MACOS_SHELL, commitsSinceWatermark, readVersionName, replaceVersionLine } from './macos.js';
import { analyzerConfig, bumpVersion, setOutput, toCommit } from './bump.js';
import { repoRoot } from './packages.mjs';

const dryRun = process.argv.includes('--dry-run');

const path = join(repoRoot, MACOS_SHELL.versionFile);
const source = readFileSync(path, 'utf8');
const current = readVersionName(source);

if (!current) {
  console.error(`${MACOS_SHELL.versionFile} declares no ${MACOS_SHELL.key}`);
  process.exit(1);
}

const commits = commitsSinceWatermark(repoRoot);

if (commits.length === 0) {
  console.log(`macos: unchanged at ${current} (no commits since it was written)`);
  setOutput('bumped', '');
  setOutput('any', 'false');
  process.exit(0);
}

// A range of `chore`/`docs`/`test` commits asks for no version at all. That is a
// real answer: a change to the shell's own tests has nothing for a user to
// receive, so bumping would ship a no-op update to everyone.
const type = await analyzeCommits(analyzerConfig, {
  commits: commits.map(toCommit),
  cwd: repoRoot,
  options: {},
  logger: { log() {} },
});

if (!type) {
  console.log(`macos: unchanged at ${current} (${commits.length} commit(s), none asks for a version bump)`);
  setOutput('bumped', '');
  setOutput('any', 'false');
  process.exit(0);
}

const next = bumpVersion(current, type);

if (!dryRun) {
  writeFileSync(path, replaceVersionLine(source, current, next));
}

console.log(`macos: ${current} -> ${next} (${type}, ${commits.length} commit(s))`);
setOutput('bumped', next);
setOutput('any', 'true');

if (dryRun) {
  console.log(`Dry run: would bump the macOS shell to ${next}`);
}
