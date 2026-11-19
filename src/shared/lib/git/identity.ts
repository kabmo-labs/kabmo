/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The commit identity: the name and email a commit carries.
 *
 * Kabmo stores a small list of identities and one selection. The selection is
 * applied to the git command that creates the commit (`-c user.name=… -c
 * user.email=…`), not written into the repository's config: the setting is
 * about the commit the panel is making, and a per-command override is
 * reversible and cannot surprise a terminal or an agent that runs git in the
 * same checkout.
 *
 * The validation is shared because the settings form and the server must agree
 * on what a usable identity is. `<`, `>` and newlines are refused: the amend
 * path passes `--author "Name <email>"`, and a name containing `>` would make
 * git read a different address than the one the user typed.
 */

export interface GitIdentity {
  id: string;
  name: string;
  email: string;
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

/** The selected identity, or null for "repository config". */
export function selectedGitIdentity(
  identities: readonly GitIdentity[],
  selectedId: string,
): GitIdentity | null {
  const id = selectedId.trim();
  if (!id) return null;
  return identities.find((identity) => identity.id === id) ?? null;
}

/** The `-c` flags that make git use this identity for the command. */
export function gitIdentityArgs(identity: GitIdentity | null): string[] {
  if (!identity) return [];
  return ['-c', `user.name=${identity.name}`, '-c', `user.email=${identity.email}`];
}

/** The `--author` flag an amend needs: `-c` alone keeps the old author. */
export function gitIdentityAuthorArgs(identity: GitIdentity | null): string[] {
  if (!identity) return [];
  return ['--author', `${identity.name} <${identity.email}>`];
}
