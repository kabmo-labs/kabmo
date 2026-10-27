#!/usr/bin/env node
/**
 * Bump every shell whose files changed since its version was last written — all
 * of them in ONE pass, committed as ONE commit by the `shells` job of
 * `.github/workflows/release.yml`.
 *
 * **Why one job.** It was five: `android → ios → windows → macos → linux`, each
 * a checkout, an install, a bump, a commit and a push. Nothing required the
 * chain — the bumps are independent, and the builds below them only need every
 * version to be on `main` — so it cost four extra checkouts, four extra
 * installs, four extra pushes and four extra commits per release. Measured on
 * this repository's history before the change: 29 shell bump commits across six
 * releases.
 *
 * **That position in the graph is still the whole design.** The job runs after
 * `marketplace` and before the five builds, and `app` fast-forwards onto the
 * commit it makes (the same `Sync to the current remote` the other bump jobs
 * rely on). A bump landing after the app packed would reach installs one
 * release late, which is exactly the lag these bumps exist to remove.
 *
 * **Why a bump is the release.** No shell is published anywhere — they are
 * private applications whose only artifact is the file attached to the app's
 * release — so the version each declares is the entire delivery mechanism:
 *
 * - Android and iOS report it on the WebView User-Agent, `GET /api/updates/{android,ios}`
 *   compares the published asset's version against it, and a shell whose number
 *   did not move is an update no installed app is ever told about.
 * - macOS, Windows and Linux report it over the desktop bridge, which is how the
 *   console knows the installed app is behind; and every publish workflow names
 *   its asset from the same file.
 *
 * **The bump LEVEL comes from the commits**, using the same rules the app, the
 * packages and the plugins use (`release/release-rules.js`), so a `fix` is a
 * patch and a `feat` is a minor. Only the bump is derived — there is no
 * changelog and no tag of its own, because neither reaches an installed app.
 *
 * The decisions and both invariants (one pass, all-or-nothing) live in
 * `release/shells-run.js`, where they are driven by tests without a history.
 *
 * usage: node release/release-shells.mjs [--dry-run] [--only <id>]
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { analyzeCommits } from '@semantic-release/commit-analyzer';
import { analyzerConfig, bumpVersion, setOutput, toCommit } from './bump.js';
import { repoRoot } from './packages.mjs';
import { SHELLS, shellById } from './shells.js';
import { runShellBumps } from './shells-run.js';

const dryRun = process.argv.includes('--dry-run');

/** The shell a `--only` run names, or null to bump every shell. */
function readOnly(argv) {
  const index = argv.indexOf('--only');
  if (index === -1) return null;

  const id = argv[index + 1];
  const shell = id ? shellById(id) : null;

  if (!shell) {
    console.error(`--only expects one of: ${SHELLS.map((entry) => entry.id).join(', ')}`);
    process.exit(1);
  }

  return shell;
}

const only = readOnly(process.argv);
const shells = only ? [only] : SHELLS;

const { outcomes, failed } = await runShellBumps({
  shells,
  root: repoRoot,
  analyze: (commits, cwd) =>
    analyzeCommits(analyzerConfig, { commits: commits.map(toCommit), cwd, options: {}, logger: { log() {} } }),
  bump: bumpVersion,
  read: (path) => readFileSync(path, 'utf8'),
  write: (path, text) => writeFileSync(path, text),
  dryRun,
});

for (const outcome of outcomes) {
  const { shell } = outcome;

  if (outcome.status === 'bumped') {
    console.log(`${shell.id}: ${outcome.from} -> ${outcome.next} (${outcome.type}, ${outcome.commits} commit(s))`);
  } else if (outcome.status === 'unchanged') {
    console.log(`${shell.id}: unchanged at ${outcome.from} (no commits since it was written)`);
  } else if (outcome.status === 'no-bump') {
    console.log(
      `${shell.id}: unchanged at ${outcome.from} (${outcome.commits} commit(s), none asks for a version bump)`,
    );
  } else {
    console.error(`${shell.id}: FAILED — ${outcome.reason}`);
  }
}

// A failed run publishes an empty answer: its step fails, so the workflow never
// reaches the commit, and an `any=true` here would claim a bump that `main`
// never receives.
const bumped = failed ? [] : outcomes.filter((outcome) => outcome.status === 'bumped');

// `android 0.7.3, ios 0.3.2` — the commit's subject names what moved, so the
// history line is the release note for the shells.
setOutput('bumped', bumped.map((outcome) => `${outcome.shell.id} ${outcome.next}`).join(', '));
setOutput('any', bumped.length > 0 ? 'true' : 'false');

if (failed) {
  // The plan above may name a bump the run then refused to write — say so, so
  // the log cannot be read as "android moved and macos did not".
  console.error('Aborted: no version file was written, and nothing will be committed.');
  process.exit(1);
}

if (bumped.length === 0) {
  console.log('No shell bump: nothing since the last version write asks for one.');
} else if (dryRun) {
  console.log(`Dry run: would bump ${bumped.map((outcome) => outcome.shell.id).join(', ')}`);
}
