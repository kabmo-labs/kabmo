#!/usr/bin/env node
/**
 * Print the Windows shell's `versionName` — one line, nothing else.
 *
 * `publish-windows.yml` needs that number twice (the `dotnet publish` that bakes
 * it into the assembly, and the asset name), and reading it inline is how the
 * Android shell's first cut went wrong:
 *
 *     sed -n 's/^versionName=//p' | sed 's/[[:space:]]*$//' version.properties
 *
 * which is wrong twice over and fails in the direction that looks like a build
 * bug: `sed -n` with no file argument reads STDIN, so the FIRST stage consumed
 * the pipeline's input and printed nothing, the SECOND stage read that empty
 * stream, and the failure surfaced later as `versionName is not versionName=0.3.0`.
 *
 * The parser lives in `release/windows.js` (`readVersionName`) and is already the
 * one the bump script and its tests use, so this is a one-line wrapper rather than
 * a second implementation of the same `key=value` rule — the same reason
 * `release/watermark.js` is shared between the plugin and shell bumps.
 *
 * Exits 1 with a message on stderr when the file declares no version: an empty
 * string reaching the workflow is what made the original failure unreadable.
 *
 * usage: node release/windows-version.mjs [--file <path>]
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WINDOWS_SHELL, readVersionName } from './windows.js';

/**
 * The repo root, from this module's own location — NOT from `packages.mjs`, which
 * imports the whole semantic-release toolchain for a constant this file does not
 * need. `fileURLToPath` rather than `.pathname`: a checkout path with a space is
 * percent-encoded in a URL.
 */
const repoRoot = fileURLToPath(new URL('..', import.meta.url));

/** A `--file` argument, so a test can point at a fixture. */
function targetFile() {
  const index = process.argv.indexOf('--file');
  const named = index === -1 ? null : process.argv[index + 1];
  return named ?? join(repoRoot, WINDOWS_SHELL.versionFile);
}

const path = targetFile();
const version = readVersionName(readFileSync(path, 'utf8'));

if (!version) {
  console.error(`${path} declares no ${WINDOWS_SHELL.key}`);
  process.exit(1);
}

process.stdout.write(version);
