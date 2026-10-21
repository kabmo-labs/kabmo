#!/usr/bin/env node
/**
 * Cut the Android shell's OWN GitHub release.
 *
 * Run by the `shell-release` job of `.github/workflows/release.yml`, after
 * `app`. Until this existed the APK could only reach a user through an APP
 * release: the `apk` job needed `app` and uploaded to `needs.app.outputs.tag`,
 * so a push that touched only `packages/android` produced a bump commit and then
 * nothing — and now that the app release is scoped away from that directory
 * (`release/app-scope.js`), it would produce a bump commit and NOTHING at all,
 * forever.
 *
 * The decision itself is `planShellRelease` in `release/android-release.js`,
 * which carries the reasoning and the tag prefix. This file is the I/O: read the
 * version, list the releases, create one, report the tag.
 *
 * usage: node release/android-release.mjs [--dry-run]
 */

import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { generateNotes } from '@semantic-release/release-notes-generator';
import { notesOptions } from '../release.config.mjs';
import { ANDROID_SHELL, commitsSinceWatermark, readVersionName } from './android.js';
import { planShellRelease, shellTag } from './android-release.js';
import { setOutput, toCommit } from './bump.js';
import { repoRoot } from './packages.mjs';

const dryRun = process.argv.includes('--dry-run');

/**
 * The commit the shell's tag is created at.
 *
 * A SHA, not `HEAD`: `--target` is forwarded to the REST API's
 * `target_commitish`, which accepts a branch name or a commit SHA — never a
 * git revision expression, so `HEAD` there is a 422 rather than this commit.
 * It is the tip this job checked out and synced to, which is the commit the
 * bump landed in.
 */
function targetSha() {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`git rev-parse HEAD failed:\n${result.stderr}`);

  return result.stdout.trim();
}

/** Run `gh` and return its stdout, its status and its stderr. */
function gh(args) {
  const result = spawnSync('gh', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });

  if (result.error) throw result.error;

  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

/**
 * The release for one tag, or null when there is none.
 *
 * `gh release view` rather than `gh release list --json tagName,assets`: the
 * list verb does not expose `assets` at all (measured on the runner's `gh` —
 * `Unknown JSON field: "assets"`, with the available set being createdAt,
 * isDraft, isImmutable, isLatest, isPrerelease, name, publishedAt, tagName), so
 * a list-shaped plan could only ever answer "no APK". One request, and the 404
 * is a real answer rather than a failure.
 *
 * A non-404 failure THROWS: a failed read must never look like "no release
 * exists", which would make the script try to re-create one that does.
 */
function findRelease(tag) {
  const result = gh(['release', 'view', tag, '--json', 'tagName,assets']);

  if (result.status !== 0) {
    if (/not found/i.test(result.stderr)) return null;
    throw new Error(`gh release view ${tag} failed:\n${result.stderr}`);
  }

  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error(`gh release view ${tag} did not answer JSON`);
  }
}

/**
 * The repository URL the notes generator links against.
 *
 * Read from `package.json` rather than restated: the notes render commit links
 * from it, and a second copy is how a release links to a repository that moved.
 */
function repositoryUrl() {
  const manifest = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
  const url = typeof manifest.repository === 'string' ? manifest.repository : manifest.repository?.url;
  if (!url) throw new Error('package.json declares no repository URL');

  return url.replace(/^git\+/, '');
}

/** The shell's release notes, from the commits that touched its directory. */
async function shellNotes(version) {
  const commits = commitsSinceWatermark(repoRoot);
  if (commits.length === 0) return `Kabmo Android ${version}`;

  return generateNotes(notesOptions, {
    commits: commits.map(toCommit),
    lastRelease: {},
    nextRelease: { version, gitTag: shellTag(version), gitHead: 'HEAD' },
    options: { repositoryUrl: repositoryUrl() },
    cwd: repoRoot,
    logger: { log() {} },
  });
}

const version = readVersionName(readFileSync(join(repoRoot, ANDROID_SHELL.versionFile), 'utf8'));

if (!version) {
  console.error(`${ANDROID_SHELL.versionFile} declares no ${ANDROID_SHELL.key}`);
  process.exit(1);
}

const plan = planShellRelease(version, findRelease(shellTag(version)));
console.log(`android release: ${plan.action} (${plan.reason})`);

if (plan.action === 'create') {
  const notes = await shellNotes(version);

  if (dryRun) {
    console.log(`Dry run: would create ${plan.tag} with:\n${notes}`);
  } else {
    const notesPath = join(repoRoot, '.android-release-notes.md');
    writeFileSync(notesPath, `${notes}\n`);

    try {
      const created = gh([
        'release',
        'create',
        plan.tag,
        '--target',
        targetSha(),
        '--title',
        `Kabmo Android ${version}`,
        '--notes-file',
        notesPath,
      ]);
      if (created.status !== 0) throw new Error(`gh release create ${plan.tag} failed:\n${created.stderr}`);
      console.log(`created ${plan.tag}`);
    } finally {
      // The notes file is a build artifact of this step, never a repository file.
      rmSync(notesPath, { force: true });
    }
  }
}

// The tag travels for BOTH the create and the attach case: the `apk` job builds
// the artifact, and in the attach case the release it uploads to already exists.
// A published release reports nothing, so that job stands down.
setOutput('tag', plan.action === 'skip' ? '' : plan.tag);
