/**
 * The parts of a version bump that every artifact shares.
 *
 * Two artifacts are released by writing a number into a checked-in file — the
 * bundled marketplace plugins and the Android shell — and neither is published
 * anywhere, so the number IS the delivery. The analysis that decides the next
 * number must therefore be the same analysis the app and the packages use, and
 * it is read from `release.config.mjs` by NAME rather than restated: a `feat`
 * has to mean one thing across every pipeline in this repository.
 *
 * What stays per-artifact is the line rewriting, because the files genuinely
 * differ: a plugin manifest has two `"version"` lines at two indents, and the
 * Android shell has one `versionName=` line.
 */

import { appendFileSync } from 'node:fs';
import appConfig from '../release.config.mjs';

/**
 * The analyzer exactly as `release.config.mjs` hands it to semantic-release —
 * looked up by name rather than restated, so a `feat` means the same thing
 * here as in the app's release.
 */
export const analyzerConfig = (() => {
  const entry = appConfig.plugins.find(
    (plugin) => Array.isArray(plugin) && plugin[0] === '@semantic-release/commit-analyzer',
  );

  if (!entry) {
    throw new Error('release.config.mjs no longer declares @semantic-release/commit-analyzer');
  }

  return entry[1];
})();

/**
 * A commit shaped like the ones semantic-release collects from `git log`.
 *
 * `analyzeCommits` reads `notes`, `type`, `subject` and `message`; the parser
 * that normally fills them is not in the loop here, so the fields it would
 * derive are left empty and the analyzer falls back to `message` — which is the
 * whole commit, header and body, and therefore carries a `BREAKING CHANGE:`
 * footer exactly as it does in the real pipeline.
 */
export function toCommit(entry) {
  const subject = entry.message.split('\n')[0] ?? '';

  return {
    hash: entry.hash,
    message: entry.message,
    subject,
    notes: [],
    type: null,
    scope: null,
    header: subject,
    body: entry.message.split('\n').slice(1).join('\n'),
    footer: '',
    revert: null,
    author: { name: 'release', email: 'release@localhost' },
    committer: { name: 'release', email: 'release@localhost' },
  };
}

/** The version one level up from `version`, for the three levels that matter. */
export function bumpVersion(version, type) {
  const [major, minor, patch] = version.split('.').map((part) => Number.parseInt(part, 10));

  if (![major, minor, patch].every(Number.isInteger)) {
    throw new Error(`cannot bump ${JSON.stringify(version)}: it is not a three-part version`);
  }

  if (type === 'major') return `${major + 1}.0.0`;
  if (type === 'minor') return `${major}.${minor + 1}.0`;

  return `${major}.${minor}.${patch + 1}`;
}

/** Write `key=value` for the workflow step that reads it. */
export function setOutput(key, value) {
  const file = process.env.GITHUB_OUTPUT;

  if (file) {
    appendFileSync(file, `${key}=${value}\n`);
  }
}
