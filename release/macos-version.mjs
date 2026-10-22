#!/usr/bin/env node
/**
 * Print the macOS shell's `versionName` — one line, nothing else.
 *
 * `scripts/build-app.sh` needs that number twice (the bundle's
 * `CFBundleShortVersionString` and `CFBundleVersion`), and reading it inline is
 * how the Android shell's first cut went wrong:
 *
 *     sed -n 's/^versionName=//p' | sed 's/[[:space:]]*$//' version.properties
 *
 * which is wrong twice over. `sed -n` with no file argument reads STDIN, so the
 * FIRST stage consumed the pipeline's input and printed nothing, the SECOND read
 * that empty stream, and the failure surfaced as `versionName is not
 * versionName=0.3.0` from a `grep` handed the literal text as its PATTERN.
 *
 * The parser lives in `release/macos.js` (`readVersionName`) and is already the
 * one the bump script and its tests use, so this is a one-line wrapper rather
 * than a second implementation of the same `key=value` rule.
 *
 * Exits 1 with a message on stderr when the file declares no version: an empty
 * string reaching the build is what made the original failure unreadable.
 *
 * usage: node release/macos-version.mjs
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MACOS_SHELL, readVersionName } from './macos.js';

/**
 * The repo root, from this module's own location — NOT from `packages.mjs`,
 * which imports the whole semantic-release toolchain for a constant this file
 * does not need. `fileURLToPath` rather than `.pathname`: a checkout path with a
 * space is percent-encoded in a URL.
 */
const repoRoot = fileURLToPath(new URL('..', import.meta.url));

const source = readFileSync(join(repoRoot, MACOS_SHELL.versionFile), 'utf8');
const version = readVersionName(source);

if (!version) {
  console.error(`${MACOS_SHELL.versionFile} declares no ${MACOS_SHELL.key}`);
  process.exit(1);
}

process.stdout.write(version);
