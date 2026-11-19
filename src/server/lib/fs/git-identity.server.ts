/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The commit identity, read from and written to the user's GLOBAL git config.
 *
 * The saved identities are a library; the global config is the source of truth.
 * Applying one writes `user.name` / `user.email` with `git config --global`, so
 * every repository that has no local override commits as that person. "Global
 * config" restores what was there before Kabmo wrote — including "nothing",
 * which unsets the key and lets git's own default answer.
 *
 * The previous values and the applied id live in the same config under
 * `kabmo.identity.*`, so the backup survives a Kabmo restart and cannot be
 * applied to the wrong scope.
 *
 * `configArgs` is the test seam: production passes `['--global']`, a test passes
 * `['--file', tempPath]` so it never touches the developer's real config.
 */

import { readSettingsJson } from '@/server/lib/db/settings-store';
import { getDb } from '@/server/db.server';
import { runGit } from '@/server/lib/fs/git-run';
import { SETTINGS_BLOB_KEY } from '@/shared/lib/settings/keys';
import {
  normalizeGitIdentities,
  type GitIdentity,
  type GitIdentityRead,
  type GitIdentityValue,
} from '@/shared/lib/git/identity';

const MARKER = 'kabmo.identity.applied';
const PREVIOUS_NAME = 'kabmo.identity.previousName';
const PREVIOUS_EMAIL = 'kabmo.identity.previousEmail';

export interface GitIdentityDeps {
  /** The config scope: `['--global']` in production, `['--file', path]` in tests. */
  configArgs?: string[];
}

export async function readGitIdentitySettings(): Promise<{ identities: GitIdentity[] }> {
  try {
    const db = await getDb();
    const blob = await readSettingsJson<Record<string, unknown> | null>(db, SETTINGS_BLOB_KEY, null);
    return { identities: normalizeGitIdentities(blob?.gitIdentities) };
  } catch {
    return { identities: [] };
  }
}

async function configValue(configArgs: string[], key: string): Promise<string | null> {
  const result = await runGit(['config', ...configArgs, '--get', key], {
    cwd: process.cwd(),
    timeout: 5_000,
  });
  if (result.error || result.exitCode !== 0) return null;
  const value = result.stdout.trim();
  return value.length > 0 ? value : null;
}

async function setConfig(configArgs: string[], key: string, value: string | null): Promise<void> {
  const result = await runGit(
    value === null
      ? ['config', ...configArgs, '--unset', key]
      : ['config', ...configArgs, key, value],
    { cwd: process.cwd(), timeout: 5_000 },
  );
  if (result.error) throw result.error;
  // `--unset` exits 5 when the key is absent; that is the desired state.
  if (result.exitCode !== 0 && !(value === null && result.exitCode === 5)) {
    throw new Error(result.stderr.trim() || `git config ${key} failed`);
  }
}

function pair(name: string | null, email: string | null): GitIdentityValue | null {
  return name && email ? { name, email } : null;
}

export async function readGitIdentity(deps: GitIdentityDeps = {}): Promise<GitIdentityRead> {
  const configArgs = deps.configArgs ?? ['--global'];
  const [name, email, appliedId] = await Promise.all([
    configValue(configArgs, 'user.name'),
    configValue(configArgs, 'user.email'),
    configValue(configArgs, MARKER),
  ]);
  return { global: pair(name, email), appliedId };
}

/**
 * Apply a saved identity to the global config, or restore the config when
 * `identity` is null.
 *
 * The first apply backs up the global values; later applies keep that backup,
 * so "Global config" always returns to what the user had before Kabmo touched
 * it.
 */
export async function applyGitIdentity(
  identity: GitIdentity | null,
  deps: GitIdentityDeps = {},
): Promise<GitIdentityRead> {
  const configArgs = deps.configArgs ?? ['--global'];

  if (identity) {
    const marker = await configValue(configArgs, MARKER);
    if (!marker) {
      const currentName = await configValue(configArgs, 'user.name');
      const currentEmail = await configValue(configArgs, 'user.email');
      await setConfig(configArgs, PREVIOUS_NAME, currentName);
      await setConfig(configArgs, PREVIOUS_EMAIL, currentEmail);
    }
    await setConfig(configArgs, 'user.name', identity.name);
    await setConfig(configArgs, 'user.email', identity.email);
    await setConfig(configArgs, MARKER, identity.id);
    return readGitIdentity(deps);
  }

  const marker = await configValue(configArgs, MARKER);
  if (marker) {
    const previousName = await configValue(configArgs, PREVIOUS_NAME);
    const previousEmail = await configValue(configArgs, PREVIOUS_EMAIL);
    await setConfig(configArgs, 'user.name', previousName);
    await setConfig(configArgs, 'user.email', previousEmail);
    await setConfig(configArgs, PREVIOUS_NAME, null);
    await setConfig(configArgs, PREVIOUS_EMAIL, null);
    await setConfig(configArgs, MARKER, null);
  }
  return readGitIdentity(deps);
}
