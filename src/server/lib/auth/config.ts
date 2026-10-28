/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * UI-auth state for ONE run of the server.
 *
 * There is no stored password. A password is supplied per invocation — through
 * `--ui-password` or `KABMO_UI_PASSWORD` — hashed in memory at boot, and
 * forgotten when the process exits. A plain `bun run dev` therefore runs with no
 * authentication, which is the default: a file on disk must not be able to
 * decide that a server the user started needs a credential they never set.
 *
 * The only thing persisted is the SESSION SIGNING SECRET, and it holds no
 * password. It is persisted for one reason: `bun run --hot` re-evaluates the
 * server entry on every save, so an in-memory secret would log the user out on
 * each edit — a dev loop that punishes the person using it. A file that only
 * signs cookies can be shared across restarts without ever being able to enable
 * authentication on its own.
 */

import fs from 'fs';
import { scryptSync } from 'node:crypto';

import { getAuthPath, getDataDir } from '@/server/lib/lifecycle/paths';

/** Shape of the persisted secret file. `version` guards a future change. */
export interface AuthSecretFile {
  version: 2;
  /** HMAC key for session tokens. Never a password, and never sufficient to log in. */
  sessionSecret: string;
  updatedAt: string;
}

/** The auth state of the running process. Null means authentication is off. */
export interface ActiveAuthConfig {
  /** argon2id hash of the password supplied for this run. */
  passwordHash: string;
  /**
   * Deterministic scrypt-derived key for THIS password and THIS secret. It is
   * what a session's fingerprint binds to; unlike {@link passwordHash} it is
   * stable across restarts, which is what keeps a session alive through one.
   */
  credentialKey: string;
  /** Signs session cookies; survives restarts so sessions do too. */
  sessionSecret: string;
}

/**
 * The stored session secret, or null when there is none.
 *
 * Any object carrying a non-empty `sessionSecret` is accepted, including the
 * retired v1 shape — reusing it means upgrading does not sign every logged-in
 * user out. The `passwordHash` that file may also carry is deliberately NOT
 * read: under this design a stored hash can never enable authentication.
 */
export async function readSessionSecret(): Promise<string | null> {
  try {
    const parsed: unknown = JSON.parse(await Bun.file(getAuthPath()).text());
    if (!parsed || typeof parsed !== 'object') return null;
    const secret = (parsed as Record<string, unknown>).sessionSecret;
    return typeof secret === 'string' && secret.length > 0 ? secret : null;
  } catch {
    // Absent, unreadable or malformed all mean "no secret to reuse": a fresh one
    // is generated, which is a logout rather than an error.
    return null;
  }
}

/**
 * Persist the session secret (temp file + rename, mode 0600). Returns false
 * instead of throwing when the data directory is not writable — the run
 * continues with the secret it generated, it just will not survive a restart.
 */
export async function writeSessionSecret(sessionSecret: string): Promise<boolean> {
  const target = getAuthPath();
  const temp = `${target}.${process.pid}.tmp`;
  const contents: AuthSecretFile = { version: 2, sessionSecret, updatedAt: new Date().toISOString() };
  try {
    fs.mkdirSync(getDataDir(), { recursive: true, mode: 0o700 });
    fs.writeFileSync(temp, `${JSON.stringify(contents, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temp, target);
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

/** Hash a password for this run. argon2id, ~70 ms — the brute-force floor. */
export function hashPassword(password: string): Promise<string> {
  return Bun.password.hash(password, { algorithm: 'argon2id' });
}

/**
 * Verify a candidate against the run's hash.
 *
 * `Bun.password.verify` compares in constant time and answers false for a
 * malformed hash rather than throwing, so a corrupted value reads as "wrong
 * password" — the outcome the user can act on.
 */
export function verifyPassword(candidate: string, passwordHash: string): Promise<boolean> {
  return Bun.password.verify(candidate, passwordHash);
}

/**
 * The value a session's fingerprint binds to, for a password and a secret.
 *
 * DETERMINISTIC on purpose: the same password with the same session secret must
 * produce the same key on every boot, because the fingerprint is what makes a
 * token fail after a password change and the token must otherwise survive a
 * restart. `passwordHash` cannot serve as that value — its argon2 salt is
 * random per boot, so a restart with the SAME password minted a new hash and
 * invalidated every session (measured: a token valid before a second `initAuth`
 * call was rejected after it, with the persisted secret correctly reused). The
 * stated point of persisting the secret — "a restart keeps its sessions" — was
 * therefore not delivered at all.
 *
 * argon2's own `salt` option is not an alternative (verified on Bun 1.4.2: two
 * hashes with the same salt still differ), so the derivation is scrypt, salted
 * with the SECRET and memory-hard for the same reason the verifier is. Nothing
 * is persisted: the secret comes from `auth.json` and the password from the
 * command line, so a leaked cookie plus that file is what an attacker would
 * need to brute-force against, exactly as before.
 */
export function deriveCredentialKey(password: string, sessionSecret: string): string {
  return scryptSync(password, sessionSecret, 32, { N: 1 << 14, r: 8, p: 1 }).toString('base64url');
}
