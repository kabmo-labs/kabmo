#!/usr/bin/env node
/**
 * Bump the Windows shell's version when `packages/windows` changed since that
 * version was last written.
 *
 * Run by the `windows` job of `.github/workflows/release.yml`, between `ios` and
 * `win-build`. **That position is the whole design**: the installer is packaged
 * BEFORE the app tags, from `main` — the branch this commit lands on — so the
 * bump is inside the tree the artifact is built from, and
 * `publish-windows.yml` reads `versionName` out of that checkout rather than out
 * of the app's tag.
 *
 * **Why a bump is the release.** The app is not published anywhere
 * (`packages/windows` is a private application), so the version it declares is the
 * entire delivery mechanism. Two readers depend on it moving:
 *
 * - `KabmoDesktop.App.csproj` bakes it into the assembly, which is what the app
 *   shows a user and reports to the page as `shellVersion` — so a release whose
 *   number did not move is indistinguishable from the previous one.
 * - `publish-windows.yml` names the asset from the same file, so the name carries
 *   this number rather than the app's tag.
 *
 * Unlike the two mobile shells there is no console download and no User-Agent
 * token: a desktop app is installed by hand from the release page, so nothing
 * offers it and nothing parses it (see `release/windows.js`).
 *
 * **The bump LEVEL comes from the commits**, using the same rules the app, the
 * packages, the plugins and the other two shells use (`release/release-rules.js`),
 * so a `fix` is a patch and a `feat` is a minor. Only the bump is derived — there
 * is no changelog and no tag of its own, because neither reaches an installed app.
 *
 * usage: node release/release-windows.mjs [--dry-run]
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { analyzeCommits } from '@semantic-release/commit-analyzer';
import { WINDOWS_SHELL, commitsSinceWatermark, readVersionName, replaceVersionLine } from './windows.js';
import { analyzerConfig, bumpVersion, setOutput, toCommit } from './bump.js';
import { repoRoot } from './packages.mjs';

const dryRun = process.argv.includes('--dry-run');

const path = join(repoRoot, WINDOWS_SHELL.versionFile);
const source = readFileSync(path, 'utf8');
const current = readVersionName(source);

if (!current) {
  console.error(`${WINDOWS_SHELL.versionFile} declares no ${WINDOWS_SHELL.key}`);
  process.exit(1);
}

const commits = commitsSinceWatermark(repoRoot);

if (commits.length === 0) {
  console.log(`windows: unchanged at ${current} (no commits since it was written)`);
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
  console.log(`windows: unchanged at ${current} (${commits.length} commit(s), none asks for a version bump)`);
  setOutput('bumped', '');
  setOutput('any', 'false');
  process.exit(0);
}

const next = bumpVersion(current, type);

if (!dryRun) {
  writeFileSync(path, replaceVersionLine(source, current, next));
}

console.log(`windows: ${current} -> ${next} (${type}, ${commits.length} commit(s))`);
setOutput('bumped', next);
setOutput('any', 'true');

if (dryRun) {
  console.log(`Dry run: would bump the Windows shell to ${next}`);
}
