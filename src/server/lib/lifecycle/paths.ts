/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Where OMPChamber keeps per-port runtime state.
 *
 * Both the server and the CLI need these paths, and they must agree: the server
 * owns the record for the port it listens on, and the CLI reads that same record
 * to answer `status` / `stop` / `logs`. One module is what makes the agreement
 * structural — the previous split (CLI wrote, server never did) is why a server
 * started outside the CLI was invisible to every CLI command.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * Root of OMPChamber's own state (~/.ompchamber, or OMPCHAMBER_DATA_DIR).
 *
 * `os.homedir()` rather than HOME: a process started without a shell (cron,
 * launchd, a service) has no HOME, and an empty value would silently move the
 * data directory to a cwd-relative path.
 */
export function getDataDir(): string {
  // `KABMO_DATA_DIR` is the name after the rename; `OMPCHAMBER_DATA_DIR` is
  // still honoured because an install that predates it keeps its database and
  // auth secret under `~/.ompchamber`. New wins when both are set.
  const override = (Bun.env.KABMO_DATA_DIR ?? Bun.env.OMPCHAMBER_DATA_DIR ?? '').trim();
  if (override) {
    return path.resolve(override.startsWith('~') ? path.join(os.homedir(), override.slice(1)) : override);
  }
  return path.join(os.homedir(), '.ompchamber');
}

/** Directory holding per-instance records and handover locks (mode 0700). */
export function getRunDir(): string {
  const dir = path.join(getDataDir(), 'run');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

/** `<data>/run/<port>.json` — the record written by the server serving `port`. */
export function getInstancePath(port: number | string): string {
  return path.join(getRunDir(), `${port}.json`);
}

/**
 * `<data>/auth.json` — the UI-auth config (argon2id password hash + session
 * signing secret).
 *
 * Deliberately per-INSTALL, not per-port: the CLI hashes a password once and
 * the server reads the hash at boot, so `restart` and `update` inherit the
 * protection without the plaintext ever being respawned. Both the CLI and the
 * server resolve it through this one function, so they cannot disagree.
 */
export function getAuthPath(): string {
  return path.join(getDataDir(), 'auth.json');
}

/** `<data>/run/<port>.lock` — held only while a port handover is in progress. */
export function getLockPath(port: number | string): string {
  return path.join(getRunDir(), `${port}.lock`);
}
