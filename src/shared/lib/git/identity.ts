/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The commit identity: the name and email a commit carries.
 *
 * Kabmo keeps a library of identities, but the REPOSITORY's local git config is
 * the source of truth for what a commit uses. Applying an identity writes
 * `user.name` / `user.email` to that repository's local config, so the commit,
 * a terminal and an agent in the same checkout all agree — the same model
 * OpenChamber uses. "Repository config" removes what Kabmo wrote and lets the
 * repository's own (or the global) identity answer again.
 *
 * The validation is shared because the settings form and the server must agree
 * on what a usable identity is. `<`, `>` and newlines are refused: a name
 * containing `>` would make git read a different address than the one the user
 * typed.
 */

export interface GitIdentity {
  id: string;
  name: string;
  email: string;
}

export interface GitIdentityValue {
  name: string;
  email: string;
}

export interface GitIdentityRead {
  /** The user's global git config, when both fields are set. */
  global: GitIdentityValue | null;
  /** The saved identity Kabmo last applied, if any. */
  appliedId: string | null;
}

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const FORBIDDEN = /[<>\n\r]/;

export function isGitIdentity(value: unknown): value is GitIdentity {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return typeof record.id === 'string'
    && ID_PATTERN.test(record.id)
    && typeof record.name === 'string'
    && record.name.trim().length > 0
    && record.name.length <= 128
    && !FORBIDDEN.test(record.name)
    && typeof record.email === 'string'
    && record.email.trim().length > 0
    && record.email.length <= 254
    && record.email.includes('@')
    && !FORBIDDEN.test(record.email);
}

/** The stored list, with malformed rows and duplicate ids dropped. */
export function normalizeGitIdentities(value: unknown): GitIdentity[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: GitIdentity[] = [];
  for (const entry of value) {
    if (!isGitIdentity(entry) || seen.has(entry.id)) continue;
    seen.add(entry.id);
    out.push({ id: entry.id, name: entry.name.trim(), email: entry.email.trim() });
  }
  return out;
}
