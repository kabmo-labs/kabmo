#!/usr/bin/env node
/**
 * Bump the Linux shell's version when `packages/linux` changed since that
 * version was last written.
 *
 * Run by the `linux` job of `.github/workflows/release.yml`, between `macos` and
 * `linux-build`. **That position is the whole design**: the archive is packaged
 * BEFORE the app tags, from `main` — the branch this commit lands on — so the
 * bump is inside the tree the artifact is built from, and `publish-linux.yml`
 * reads `versionName` out of that checkout rather than out of the app's tag.
 *
 * **Why a bump is the release.** The app is not published anywhere
 * (`packages/linux` is a private application), so the version it declares is the
 * entire delivery mechanism. Two readers depend on it moving:
 *
 * - `build.rs` bakes it into the binary as `KABMO_SHELL_VERSION`, which is what the
 *   app reports to the page as `shellVersion` — so a release whose number did not
 *   move is indistinguishable from the previous one.
 * - `publish-linux.yml` names the asset from the same file, so the name carries
 *   this number rather than the app's tag.
 *
 * Unlike the two mobile shells there is no console download and no User-Agent
 * token: a desktop app is installed by hand from the release page, so nothing
 * offers it and nothing parses it (see `release/linux.js`).
 *
 * **The bump LEVEL comes from the commits**, using the same rules the app, the
 * packages, the plugins and the other three shells use (`release/release-rules.js`),
 * so a `fix` is a patch and a `feat` is a minor. Only the bump is derived — there
 * is no changelog and no tag of its own, because neither reaches an installed app.
 *
 * usage: node release/release-linux.mjs [--dry-run]
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { analyzeCommits } from '@semantic-release/commit-analyzer';
import { LINUX_SHELL, commitsSinceWatermark, readVersionName, replaceVersionLine } from './linux.js';
import { analyzerConfig, bumpVersion, setOutput, toCommit } from './bump.js';
import { repoRoot } from './packages.mjs';

const dryRun = process.argv.includes('--dry-run');

const path = join(repoRoot, LINUX_SHELL.versionFile);
const source = readFileSync(path, 'utf8');
const current = readVersionName(source);

if (!current) {
  console.error(`${LINUX_SHELL.versionFile} declares no ${LINUX_SHELL.key}`);
  process.exit(1);
}

const commits = commitsSinceWatermark(repoRoot);

if (commits.length === 0) {
  console.log(`linux: unchanged at ${current} (no commits since it was written)`);
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
  console.log(`linux: unchanged at ${current} (${commits.length} commit(s), none asks for a version bump)`);
  setOutput('bumped', '');
  setOutput('any', 'false');
  process.exit(0);
}

const next = bumpVersion(current, type);

if (!dryRun) {
  writeFileSync(path, replaceVersionLine(source, current, next));
}

console.log(`linux: ${current} -> ${next} (${type}, ${commits.length} commit(s))`);
setOutput('bumped', next);
setOutput('any', 'true');

if (dryRun) {
  console.log(`Dry run: would bump the Linux shell to ${next}`);
}
