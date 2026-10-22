#!/usr/bin/env node
/**
 * Bump the iOS shell's version when `packages/ios` changed since that version was
 * last written.
 *
 * Run by the `ios` job of `.github/workflows/release.yml`, beside the Android bump
 * and BEFORE `app` tags. **That position is the whole design**: the IPA is built
 * from `main` — the branch this commit lands on — so the bump is inside the tree the
 * artifact is built from, and the asset `publish-ios.yml` attaches names that
 * version rather than the app's tag. Building the run's STARTING commit would
 * declare the previous shell version, which is an update no installed app is ever
 * offered.
 *
 * **Why a bump is the release.** The IPA is not published anywhere
 * (`packages/ios` is a private application), so the version it declares is the
 * entire delivery mechanism. Two readers depend on it moving:
 *
 * - the shell appends `KabmoIOS/<versionName>` to its WebView User-Agent, the
 *   console parses it into `iosShellVersion`, and `GET /api/updates/ios` offers a
 *   download only when the published asset is NEWER. A fix whose version did not
 *   move is an update no installed app is ever told about.
 * - `fetchShellRelease('ios')` reads the version out of the asset NAME, so the name
 *   has to carry this number rather than the app's tag.
 *
 * The Android shell learned this the hard way — its version used to BE the app's
 * tag, which tied two independent release cadences together. iOS starts from the
 * fixed shape: a shell-only fix ships under a shell version, and a server release
 * ships an IPA whose version says whether the shell changed.
 *
 * **The bump LEVEL comes from the commits**, using the same rules the app, the
 * packages and the plugins use (`release/release-rules.js`), so a `fix` is a patch
 * and a `feat` is a minor. Only the bump is derived — there is no changelog and no
 * tag of its own, because neither reaches an installed app.
 *
 * usage: node release/release-ios.mjs [--dry-run]
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { analyzeCommits } from '@semantic-release/commit-analyzer';
import { IOS_SHELL, commitsSinceWatermark, readVersionName, replaceVersionLine } from './ios.js';
import { analyzerConfig, bumpVersion, setOutput, toCommit } from './bump.js';
import { repoRoot } from './packages.mjs';

const dryRun = process.argv.includes('--dry-run');

const path = join(repoRoot, IOS_SHELL.versionFile);
const source = readFileSync(path, 'utf8');
const current = readVersionName(source);

if (!current) {
  console.error(`${IOS_SHELL.versionFile} declares no ${IOS_SHELL.key}`);
  process.exit(1);
}

const commits = commitsSinceWatermark(repoRoot);

if (commits.length === 0) {
  console.log(`ios: unchanged at ${current} (no commits since it was written)`);
  setOutput('bumped', '');
  setOutput('any', 'false');
  process.exit(0);
}

// A range of `chore`/`docs`/`test` commits asks for no version at all. That is a
// real answer: a change to the shell's own tests has nothing for an installed app
// to receive, so bumping would ship a no-op update to every user.
const type = await analyzeCommits(analyzerConfig, {
  commits: commits.map(toCommit),
  cwd: repoRoot,
  options: {},
  logger: { log() {} },
});

if (!type) {
  console.log(`ios: unchanged at ${current} (${commits.length} commit(s), none asks for a version bump)`);
  setOutput('bumped', '');
  setOutput('any', 'false');
  process.exit(0);
}

const next = bumpVersion(current, type);

if (!dryRun) {
  writeFileSync(path, replaceVersionLine(source, current, next));
}

console.log(`ios: ${current} -> ${next} (${type}, ${commits.length} commit(s))`);
setOutput('bumped', next);
setOutput('any', 'true');

if (dryRun) {
  console.log(`Dry run: would bump the iOS shell to ${next}`);
}
