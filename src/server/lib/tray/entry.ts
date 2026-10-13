/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The argv a login entry runs, built from the invocation that registered it.
 *
 * Two decisions are load-bearing, and both come from the same failure:
 *
 * 1. **The entry runs `serve --foreground`, so the CLI stays alive as the job's
 *    program.** launchd reaps a job's whole process tree when the job's program
 *    exits. A detached `serve` returns as soon as the health check passes, so
 *    the tree it spawned is torn down with it — verified: `launchctl print`
 *    reported `state = not running` while the log recorded a successful start.
 *    In the foreground the CLI is the long-lived job, the server is its child,
 *    and the tray is the server's child: one tree, nothing exiting early.
 *
 * 2. **`--prod` is pinned, and `--startup` is stripped.** A login entry has no
 *    shell to export `NODE_ENV`, so the mode has to be in argv. `--startup` is
 *    removed because the entry must not re-register itself on every boot — the
 *    file IS the registration.
 *
 * `--tray` travels only when the registering invocation asked for it, so
 * `--startup` alone (no icon) is a supported shape: the console comes up at
 * login without an icon.
 */

import fs from 'node:fs';

import { PROD_FLAG, TRAY_FLAG } from '@/server/lib/lifecycle/argv-flags';

/**
 * Resolve `..`/symlinks, falling back to the input when the path does not exist.
 *
 * The CLI resolves its own root as `<dir>/../..` and its path helper does not
 * collapse a `..` segment, so a raw value reaches a generated plist as
 * `<pkg>/src/cli/../../src/cli/ompchamber.js`. The OS would follow it, but a
 * login entry outlives the process that wrote it and is read by a human
 * debugging `launchctl print` — measured in a generated LaunchAgent.
 */
function canonicalize(value: string): string {
  try {
    return fs.realpathSync(value);
  } catch {
    return value;
  }
}

export interface LoginEntryInput {
  /** Bun binary to run the CLI with. */
  bun: string;
  /** Absolute path to `src/cli/ompchamber.js`. */
  cli: string;
  port: number;
  host: string;
  /** Raise the tray icon in the login-started server too. */
  tray: boolean;
  /** Serve over TLS, matching the registering invocation. */
  tls: boolean;
  /** Bind to every interface, matching the registering invocation. */
  lan: boolean;
}

/**
 * Build the argv for a login entry.
 *
 * `--foreground` is added and `--lan` is expressed as `--host 0.0.0.0` rather
 * than carried as a flag: the entry stores an explicit address, so a later
 * change to what `--lan` means cannot silently move a registered server.
 */
export function buildLoginEntryArgv(input: LoginEntryInput): string[] {
  const argv = [input.bun, canonicalize(input.cli), 'serve', '--foreground', PROD_FLAG, '--port', String(input.port)];
  argv.push('--host', input.lan ? '0.0.0.0' : input.host);
  if (input.tray) argv.push(TRAY_FLAG);
  if (input.tls) argv.push('--tls');
  return argv;
}
