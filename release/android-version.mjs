#!/usr/bin/env node
/**
 * Print the Android shell's `versionName` — one line, nothing else.
 *
 * `publish-android.yml` needs that number three times (the build, the `aapt2`
 * check on the artifact, the asset name), and the first cut of this read it
 * inline:
 *
 *     sed -n 's/^versionName=//p' | sed 's/[[:space:]]*$//' version.properties
 *
 * which is wrong twice over and fails in the direction that looks like a build
 * bug. `sed -n` with no file argument reads STDIN, so the FIRST stage consumed
 * the pipeline's input and printed nothing, the SECOND stage read that empty
 * stream, and the command printed nothing at all — `version` was empty, the
 * `test -n` guard did not exist on the verify step, and the failure surfaced as
 * `versionName is not versionName=0.3.0` from a `grep` that had been handed the
 * literal text `versionName=0.3.0` as its PATTERN.
 *
 * The parser lives in `release/android.js` (`readVersionName`) and is already
 * the one the bump script and its tests use, so this is a one-line wrapper
 * rather than a second implementation of the same `key=value` rule — the same
 * reason `release/watermark.js` is shared between the plugin and shell bumps.
 *
 * Exits 1 with a message on stderr when the file declares no version: an empty
 * string reaching the workflow is what made the original failure unreadable.
 *
 * usage: node release/android-version.mjs [--file <path>]
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ANDROID_SHELL, readVersionName } from './android.js';

/**
 * The repo root, from this module's own location — NOT from `packages.mjs`,
 * which imports the whole semantic-release toolchain for a constant this file
 * does not need. `fileURLToPath` rather than `.pathname`, for the reason that
 * module documents: a checkout path with a space is percent-encoded in a URL.
 */
const repoRoot = fileURLToPath(new URL('..', import.meta.url));

/** A `--file` argument, so a test can point at a fixture. */
function targetFile() {
  const index = process.argv.indexOf('--file');
  const named = index === -1 ? null : process.argv[index + 1];
  return named ?? join(repoRoot, ANDROID_SHELL.versionFile);
}

const path = targetFile();
const version = readVersionName(readFileSync(path, 'utf8'));

if (!version) {
  console.error(`${path} declares no ${ANDROID_SHELL.key}`);
  process.exit(1);
}

process.stdout.write(version);
