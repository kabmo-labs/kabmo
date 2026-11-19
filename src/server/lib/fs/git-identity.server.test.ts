/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getDb } from '@/server/db.server';
import { writeSettingsJson } from '@/server/lib/db/settings-store';
import {
  applyGitIdentity,
  readGitIdentity,
  readGitIdentitySettings,
  type GitIdentityDeps,
} from '@/server/lib/fs/git-identity.server';
import { SETTINGS_BLOB_KEY } from '@/shared/lib/settings/keys';
import { isolateDb, releaseDb } from '@/test-support/isolated-db';
import { removeDir } from '@/test-support/remove-dir';

const dirs: string[] = [];
const WORK = { id: 'work', name: 'Work User', email: 'work@example.invalid' };
const PERSONAL = { id: 'personal', name: 'Personal', email: 'me@example.invalid' };

function gitConfig(file: string, ...args: string[]): string {
  const result = Bun.spawnSync({ cmd: ['git', 'config', '--file', file, ...args] });
  if (result.exitCode !== 0) {
    throw new Error(`git config ${args.join(' ')} failed: ${result.stderr.toString()}`);
  }
  return result.stdout.toString().trim();
}

function makeConfig(local: { name: string; email: string } | null): GitIdentityDeps {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kabmo-identity-'));
  dirs.push(dir);
  const file = path.join(dir, 'gitconfig');
  fs.writeFileSync(file, '');
  if (local) {
    gitConfig(file, 'user.name', local.name);
    gitConfig(file, 'user.email', local.email);
  }
  return { configArgs: ['--file', file] };
}

beforeEach(async () => {
  await isolateDb();
});

afterEach(async () => {
  await releaseDb();
});

afterAll(() => {
  for (const dir of dirs) removeDir(dir);
});

describe('readGitIdentitySettings', () => {
  test('reads the saved list', async () => {
    const db = await getDb();
    await writeSettingsJson(db, SETTINGS_BLOB_KEY, {
      gitIdentities: [WORK, PERSONAL],
    });
    expect(await readGitIdentitySettings()).toEqual({ identities: [WORK, PERSONAL] });
  });

  test('a malformed list is empty', async () => {
    const db = await getDb();
    await writeSettingsJson(db, SETTINGS_BLOB_KEY, {
      gitIdentities: [{ id: 'bad', name: '', email: 'x@y' }],
    });
    expect(await readGitIdentitySettings()).toEqual({ identities: [] });
  });
});

describe('readGitIdentity', () => {
  test('reads the global config', async () => {
    const deps = makeConfig({ name: 'Global User', email: 'global@example.invalid' });

    const read = await readGitIdentity(deps);

    expect(read.global).toEqual({ name: 'Global User', email: 'global@example.invalid' });
    expect(read.appliedId).toBeNull();
  });
});

describe('applyGitIdentity', () => {
  test('writes the identity to the global config and marks it', async () => {
    const deps = makeConfig({ name: 'Global User', email: 'global@example.invalid' });

    const read = await applyGitIdentity(WORK, deps);

    expect(read.global).toEqual({ name: WORK.name, email: WORK.email });
    expect(read.appliedId).toBe(WORK.id);
    expect(gitConfig(deps.configArgs![1], '--get', 'user.name')).toBe(WORK.name);
    expect(gitConfig(deps.configArgs![1], '--get', 'user.email')).toBe(WORK.email);
  });

  test('global config restores the previous values', async () => {
    const deps = makeConfig({ name: 'Global User', email: 'global@example.invalid' });
    await applyGitIdentity(WORK, deps);

    const read = await applyGitIdentity(null, deps);

    expect(read.global).toEqual({ name: 'Global User', email: 'global@example.invalid' });
    expect(read.appliedId).toBeNull();
    expect(gitConfig(deps.configArgs![1], '--get', 'user.name')).toBe('Global User');
  });

  test('a second apply keeps the original backup', async () => {
    const deps = makeConfig({ name: 'Global User', email: 'global@example.invalid' });
    await applyGitIdentity(WORK, deps);
    await applyGitIdentity(PERSONAL, deps);

    const read = await applyGitIdentity(null, deps);

    expect(read.global).toEqual({ name: 'Global User', email: 'global@example.invalid' });
  });

  test('a config with no identity is restored to no identity', async () => {
    const deps = makeConfig(null);
    await applyGitIdentity(WORK, deps);

    const read = await applyGitIdentity(null, deps);

    expect(read.global).toBeNull();
    expect(read.appliedId).toBeNull();
  });
});
