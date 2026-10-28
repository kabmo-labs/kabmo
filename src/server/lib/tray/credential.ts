/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The credential a login entry needs, stored where only its owner can read it.
 *
 * A login entry is a COMMAND LINE: a launchd plist (mode 0644), an XDG
 * `.desktop` file, a Windows Run value. Writing `--ui-password <secret>` into
 * any of them publishes the password to every user on the machine and to
 * anything that reads the file later — and the entry outlives the run that
 * wrote it. Measured: the generated plist was 0644 in a directory launchd reads
 * at login, and the password appeared verbatim in the CLI's own `ps` line.
 *
 * So the entry carries a PATH instead of a secret, and the secret lives in
 * `<data>/autostart-credential` at mode 0600 — the same directory that already
 * holds `auth.json` (also 0600) and the SQLite database. The CLI reads it on
 * the way in and hands it to the server through the stdin handover, so it never
 * appears in an argv or an inherited environment either.
 *
 * What this does NOT do is make the password unreadable to the account that
 * owns it: a file has to be readable by its owner to be used. It removes the
 * two exposures that were not a choice — world-readable metadata and `ps`.
 */

import fs from 'node:fs';

import { getDataDir } from '@/server/lib/lifecycle/paths';

/** `<data>/autostart-credential` — read only by the login entry's own run. */
export function getAutostartCredentialPath(): string {
  return `${getDataDir()}/autostart-credential`;
}

/** Persist the password for a login entry (mode 0600). Returns false when unwritable. */
export function writeAutostartCredential(password: string): boolean {
  const target = getAutostartCredentialPath();
  const temp = `${target}.${process.pid}.tmp`;
  try {
    fs.mkdirSync(getDataDir(), { recursive: true, mode: 0o700 });
    fs.writeFileSync(temp, password, { mode: 0o600 });
    fs.renameSync(temp, target);
    // `rename` keeps the temp file's mode, but a pre-existing file could have
    // been wider: chmod is what makes the promise true on every path.
    fs.chmodSync(target, 0o600);
    return true;
  } catch {
    try {
      fs.rmSync(temp, { force: true });
    } catch {
      // Best-effort cleanup only.
    }
    return false;
  }
}

/**
 * The stored credential, or null when there is none.
 *
 * A missing file is normal: `--no-startup` removes it, and an install that
 * never registered one never had it. A login entry whose file vanished starts
 * open, which is why the CLI reports that rather than failing the boot.
 */
export function readAutostartCredential(): string | null {
  try {
    const value = fs.readFileSync(getAutostartCredentialPath(), 'utf8').trim();
    return value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

/** Remove the stored credential. Never throws. */
export function removeAutostartCredential(): void {
  try {
    fs.rmSync(getAutostartCredentialPath(), { force: true });
  } catch {
    // Best-effort: a stale file is readable only by its owner anyway.
  }
}
