/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { getDb } from '@/server/db.server';
import { writeSettingsJson } from '@/server/lib/db/settings-store';
import { readGitIdentitySettings, readSelectedGitIdentity } from '@/server/lib/fs/git-identity.server';
import { SETTINGS_BLOB_KEY } from '@/shared/lib/settings/keys';
import { isolateDb, releaseDb } from '@/test-support/isolated-db';

beforeEach(async () => {
  await isolateDb();
});

afterEach(async () => {
  await releaseDb();
});

describe('readGitIdentitySettings', () => {
  test('reads the saved list and the selection', async () => {
    const db = await getDb();
    await writeSettingsJson(db, SETTINGS_BLOB_KEY, {
      gitIdentities: [
        { id: 'work', name: 'Work User', email: 'work@example.invalid' },
        { id: 'personal', name: 'Personal', email: 'me@example.invalid' },
      ],
      gitCommitIdentity: 'personal',
    });

    expect(await readGitIdentitySettings()).toEqual({
      identities: [
        { id: 'work', name: 'Work User', email: 'work@example.invalid' },
        { id: 'personal', name: 'Personal', email: 'me@example.invalid' },
      ],
      selectedId: 'personal',
    });
    expect(await readSelectedGitIdentity()).toEqual({
      id: 'personal',
      name: 'Personal',
      email: 'me@example.invalid',
    });
  });

  test('a malformed list and an unknown selection mean repository config', async () => {
    const db = await getDb();
    await writeSettingsJson(db, SETTINGS_BLOB_KEY, {
      gitIdentities: [{ id: 'bad', name: '', email: 'x@y' }],
      gitCommitIdentity: 'bad',
    });

    expect(await readGitIdentitySettings()).toEqual({ identities: [], selectedId: 'bad' });
    expect(await readSelectedGitIdentity()).toBeNull();
  });

  test('an absent blob is repository config', async () => {
    expect(await readGitIdentitySettings()).toEqual({ identities: [], selectedId: '' });
    expect(await readSelectedGitIdentity()).toBeNull();
  });
});
