// The one interactive offer Kabmo makes about oh-my-pi.
//
// `serve` refuses to start without an `omp` binary, and before this the only
// remedy was a paragraph the user had to copy out of the error. The offer runs
// `bun install -g @oh-my-pi/pi-coding-agent` — the SOURCE route, never the
// `curl | sh` installer: a product that pipes a remote script through a shell
// as part of `serve` is a decision the operator never made, and the printed
// line already names both routes for anyone who prefers the prebuilt binary.
//
// Three rules make the prompt safe:
//
//   - It is asked ONLY on a TTY, never in JSON/quiet mode. A pipe or a daemon
//     start must not block on a question nobody can answer (`serve` writes a
//     login entry and detaches; a hung read there is a broken login).
//   - The default is NO. Enter alone declines, so a stray keystroke on a
//     production box never rewrites the global Bun prefix.
//   - A failure is reported and nothing else happens: the caller still applies
//     the startup gate, so a half-installed omp cannot make the server look
//     healthy.

import { createInterface } from 'node:readline/promises';

import { color, log, warn } from '@/cli/lib/output.js';
import { resolveBunBin } from '@/cli/lib/runtime.js';
import { invalidateOmpCliCache, resolveOmpBin } from '@/server/lib/omp/core/cli';
import { ompInstallCommands } from '@/server/lib/omp/core/install-hint';

/** Whether this process may ask the question at all. */
export function canOfferOmpInstall({ isTTY, json, quiet }) {
  return Boolean(isTTY) && !json && !quiet;
}

/** Yes, and only the spellings a user actually types. Everything else is a no. */
export function isYes(answer) {
  const value = String(answer ?? '').trim().toLowerCase();
  return value === 'y' || value === 'yes';
}

/**
 * Ask, defaulting to no. The interface is closed on every path: an open readline
 * keeps stdin in raw-ish mode and the detached spawn that follows would inherit
 * a terminal that no longer echoes.
 */
async function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(question);
    return answer;
  } finally {
    rl.close();
  }
}

/**
 * Run the source install, streaming its output.
 *
 * Streamed rather than buffered because `bun install -g` prints progress, and a
 * silent minute is indistinguishable from a hang. The `omp` probe is
 * invalidated afterwards: a miss is cached for 30s, and the gate that runs next
 * must see the binary that was just written.
 */
export async function installOmpSource({ bun = null } = {}) {
  const bin = bun ?? resolveBunBin();
  const { source } = ompInstallCommands();
  const parts = source.split(' ');
  const proc = Bun.spawn({
    cmd: [bin, ...parts.slice(1)],
    stdin: 'ignore',
    stdout: 'inherit',
    stderr: 'inherit',
    env: { ...Bun.env, FORCE_COLOR: '0' },
  });
  const exitCode = await proc.exited;
  invalidateOmpCliCache();
  return { exitCode, installed: Boolean(resolveOmpBin()) };
}

/**
 * The whole interaction: print the remedy, ask, install when told to.
 *
 * Returns what happened so the caller can word the outcome and still decide
 * about the startup gate itself — this module never exits the process.
 */
export async function offerOmpInstall({
  isTTY = Boolean(process.stdin.isTTY),
  json = false,
  quiet = false,
  confirm = ask,
  install = installOmpSource,
} = {}) {
  if (!canOfferOmpInstall({ isTTY, json, quiet })) return 'unavailable';

  const { source, binary } = ompInstallCommands();
  log('');
  log('Kabmo drives your existing omp binary and does not install one by itself.');
  log(`  install from source:  ${source}`);
  log(`  or the prebuilt one:  ${binary}`);
  log('');

  let answer;
  try {
    answer = await confirm(`Install oh-my-pi from source now? [y/N] `);
  } catch {
    // A closed stdin (Ctrl+D, a terminal that went away) is a decline.
    return 'declined';
  }
  if (!isYes(answer)) {
    log(color.dim('Skipped — nothing was installed.'));
    return 'declined';
  }

  let result;
  try {
    result = await install();
  } catch (err) {
    warn(`Install failed: ${err instanceof Error ? err.message : String(err)}`);
    return 'failed';
  }

  if (result.exitCode !== 0) {
    warn(`Install exited with code ${result.exitCode}.`);
    return 'failed';
  }
  if (!result.installed) {
    // The install reported success but `omp` still does not resolve: say so
    // instead of letting the gate below print a second, unrelated message.
    warn('The install finished, but `omp` is still not on PATH. Open a new shell, or set KABMO_OMP_BIN.');
    return 'failed';
  }
  return 'installed';
}
