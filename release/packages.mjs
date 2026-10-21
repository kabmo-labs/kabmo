/**
 * The semantic-release configuration for one published package.
 *
 * The packages are released from the SAME repository and the same history as
 * the app, so everything here is about narrowing a commit range down to the
 * commits that belong to one package — the version rules, the changelog shape
 * and the contributor credit are the app's, reused rather than restated.
 *
 * Three mechanisms do the narrowing, and all three are needed:
 *
 * 1. **A per-package `tagFormat`.** `kabmo-sdk/v${version}` makes
 *    `release/commits.js` range the commits since that package's own last tag,
 *    so a release is decided from what changed since it was last published.
 * 2. **A path filter in front of the analyzer and the notes generator.** A tag
 *    range still contains every app commit made in between, and a `feat` in one
 *    of those would bump the package's minor version while its own code did not
 *    change at all. The filter keeps only commits that touched the package
 *    directory, which is the same rule a maintainer applies by hand.
 * 3. **A local version plugin** (`release/version-package.mjs`) writes the new
 *    version into the package's own `package.json`. `@semantic-release/npm`
 *    cannot do it here: it shells out to `npm version`, and npm does not support
 *    the `workspace:` protocol this workspace declares. The plugin's file header
 *    carries the measurement.
 *
 * The filter is applied by WRAPPING the analyzer and the notes generator rather
 * than by using a shareable config: `context.commits` is what both read, and
 * semantic-release hands the same context to every plugin in a step, so the
 * only place a subset can be introduced is inside the plugin call.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { analyzeCommits as analyzeCommitsStep } from '@semantic-release/commit-analyzer';
import { generateNotes as generateNotesStep } from '@semantic-release/release-notes-generator';
import { analyzerOptions, notesOptions } from '../release.config.mjs';
import { filesForCommits } from './commits.js';
import { tagPrefix } from './packages.js';
import { versionPackagePlugin } from './version-package.mjs';

/**
 * The repo root, from this module's own location.
 *
 * `fileURLToPath` rather than `.pathname`: a checkout path with a space in it
 * (or a Windows drive letter) would otherwise arrive percent-encoded.
 */
export const repoRoot = fileURLToPath(new URL('..', import.meta.url));

/**
 * The commits that touched a directory, in the shape the analyzer and the notes
 * generator expect.
 *
 * `cwd` is the repository the commits were collected from — `context.cwd`, not
 * a path derived from this module. They are the same in the pipeline, but a
 * caller that collected commits somewhere else (a test's scratch repository)
 * would otherwise have its hashes looked up in the wrong tree and every commit
 * would look path-less, which reads as "keep everything".
 *
 * A commit with no paths at all — a merge, or an empty commit — is kept. It
 * carries no change of its own, and dropping it would also drop a `revert` that
 * git recorded that way.
 *
 * @param {string} dir Package directory, relative to the repository root.
 * @param {Array<object>} commits
 * @param {string} cwd The repository the commits came from.
 * @returns {Array<object>}
 */
export function scopeCommits(dir, commits, cwd) {
  if (commits.length === 0) {
    return commits;
  }

  const files = filesForCommits(
    commits.map((commit) => commit.hash),
    cwd,
  );
  const prefix = `${dir}/`;

  return commits.filter((commit) => {
    const paths = files.get(commit.hash) ?? [];

    return paths.length === 0 || paths.some((path) => path === dir || path.startsWith(prefix));
  });
}

/**
 * The commit-analyzer step, reading only this package's commits.
 *
 * @param {string} dir
 * @returns {(pluginConfig: object, context: object) => Promise<string|null>}
 */
export function scopedAnalyzeCommits(dir) {
  return (pluginConfig, context) =>
    analyzeCommitsStep(pluginConfig, {
      ...context,
      commits: scopeCommits(dir, context.commits, context.cwd),
    });
}

/**
 * The notes-generator step, reading only this package's commits.
 *
 * @param {string} dir
 * @returns {(pluginConfig: object, context: object) => Promise<string>}
 */
export function scopedGenerateNotes(dir) {
  return (pluginConfig, context) =>
    generateNotesStep(pluginConfig, {
      ...context,
      commits: scopeCommits(dir, context.commits, context.cwd),
    });
}

/**
 * The changelog's fixed preamble. The app reads its own from `CHANGELOG.md`;
 * a package's changelog is created by its first release, so the text is stated
 * here and only has to survive being written once.
 *
 * @param {string} name
 * @returns {string}
 */
function changelogTitle(name) {
  return [
    `# ${name}`,
    '',
    'All notable changes to this package are documented in this file.',
    '',
    'The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),',
    'and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).',
  ].join('\n');
}

/**
 * The version a package's manifest currently declares.
 *
 * @param {string} dir
 * @returns {string}
 */
export function packageVersion(dir) {
  const manifest = JSON.parse(readFileSync(new URL(`../${dir}/package.json`, import.meta.url), 'utf8'));

  return manifest.version;
}

/**
 * Everything semantic-release needs to cut one package's release.
 *
 * @param {{dir: string, name: string}} entry A `release/packages.js` row.
 * @returns {object}
 */
export function packageReleaseConfig(entry) {
  const { dir, name } = entry;
  const prefix = tagPrefix(entry);

  return {
    branches: ['main'],
    tagFormat: `${prefix}/v\${version}`,
    // The two scoped steps live on their OWN keys rather than in `plugins`,
    // because semantic-release validates a `plugins` entry differently from a
    // step entry: `validatePlugin` requires an array's first element to be a
    // string or a plain object, while `validateStep` accepts a function — and
    // the step keys are the only place a function can carry options.
    analyzeCommits: [
      [
        scopedAnalyzeCommits(dir),
        { ...analyzerOptions },
      ],
    ],
    generateNotes: [[scopedGenerateNotes(dir), { ...notesOptions }]],
    plugins: [
      versionPackagePlugin(dir),
      ['@semantic-release/changelog', { changelogFile: `${dir}/CHANGELOG.md`, changelogTitle: changelogTitle(name) }],
      [
        '@semantic-release/git',
        {
          // `bun.lock` is here because the version plugin rewrites it: it
          // records a version per workspace package, and `bun publish`
          // substitutes a `workspace:` spec from THAT record. Leaving the
          // refreshed lock uncommitted would re-publish the stale pin on the
          // next release (see version-package.mjs for the measurement).
          assets: [`${dir}/CHANGELOG.md`, `${dir}/package.json`, 'bun.lock'],
          message: `chore(release): ${prefix}/v\${nextRelease.version} [skip ci]`,
        },
      ],
      '@semantic-release/github',
    ],
  };
}
