/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Where Kabmo keeps per-port runtime state.
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

/** The directory name this install used before the rename. */
const LEGACY_DIR_NAME = '.ompchamber';

/** The current directory name. */
const DATA_DIR_NAME = '.kabmo';

/**
 * Move a pre-rename data directory into place, once.
 *
 * A rename must not cost an existing install its database, login and sessions,
 * and nothing else would ever move them: the new build simply looks in a
 * directory that does not exist yet and starts empty.
 *
 * Deliberately NOT called from `getDataDir()`: that getter is read by tests and
 * by pure path resolution, and a rename of the developer's own home directory is
 * a side effect no caller of a path helper can be expected to anticipate. The
 * server bootstrap and the CLI entry call it explicitly, once per process.
 *
 * The move happens only when the current directory is ABSENT and the legacy one
 * is present, so it can never overwrite a live install. `rename` is the fast
 * path (same filesystem, atomic); it fails with `EXDEV` when the two live on
 * different mounts, and with `EPERM`/`EBUSY` on Windows while a file is open —
 * the fallback is a recursive copy followed by a best-effort delete, which
 * leaves the old directory behind rather than losing data halfway through.
 *
 * A failure is NOT fatal: the caller falls back to the empty new directory,
 * which is the same state a fresh install starts in.
 */
export function migrateLegacyDataDir(home: string = os.homedir()): void {
  const legacy = path.join(home, LEGACY_DIR_NAME);
  const target = path.join(home, DATA_DIR_NAME);
  try {
    if (fs.existsSync(target) || !fs.existsSync(legacy)) return;
    try {
      fs.renameSync(legacy, target);
      return;
    } catch {
      fs.cpSync(legacy, target, { recursive: true, errorOnExist: false, force: false });
      fs.rmSync(legacy, { recursive: true, force: true });
    }
  } catch {
    // Best-effort: a read-only home directory leaves the install starting
    // empty, which the boot banner reports by printing the db path it uses.
  }
}

/**
 * Root of Kabmo's own state (`~/.kabmo`, or `KABMO_DATA_DIR`).
 *
 * `os.homedir()` rather than HOME: a process started without a shell (cron,
 * launchd, a service) has no HOME, and an empty value would silently move the
 * data directory to a cwd-relative path.
 *
 * `OMPCHAMBER_DATA_DIR` is still honoured as a fallback for an install whose
 * unit file or shell profile exports it; the new name wins when both are set.
 */
export function getDataDir(): string {
  const override = (Bun.env.KABMO_DATA_DIR ?? Bun.env.OMPCHAMBER_DATA_DIR ?? '').trim();
  if (override) {
    return path.resolve(override.startsWith('~') ? path.join(os.homedir(), override.slice(1)) : override);
  }
  return path.join(os.homedir(), DATA_DIR_NAME);
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
