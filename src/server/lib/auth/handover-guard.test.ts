/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Arming authentication from a credential a PREVIOUS process computed.
 *
 * This is the self-restart path. The replacement is spawned by `ompchamber
 * restart`, which never had the plaintext — the instance being replaced did,
 * and it has already hashed it. The property under test is that the pair
 * `credentialKey` + `sessionSecret` travels together: without the secret the
 * key means nothing, and a replacement that generated a fresh one would sign
 * every session out on a restart the user did not ask for.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { authGate, initAuth, initAuthFromHandover, isAuthEnabled, loadAuthConfig } from '@/server/lib/auth/guard';
import { issueSessionToken, SESSION_TTL_MS } from '@/server/lib/auth/token';

let tempDir: string | null = null;

afterEach(async () => {
  // `initAuth(null)` is the reset: the module slot is process-wide, so a test
  // that armed a password would otherwise leak it into the next one.
  await initAuth(null);
  if (tempDir) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
  delete Bun.env.OMPCHAMBER_DATA_DIR;
});

function useTempDataDir(): void {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ompchamber-handover-test-'));
  Bun.env.OMPCHAMBER_DATA_DIR = tempDir;
}

describe('initAuthFromHandover', () => {
  test('a hashed credential arms auth without the plaintext', async () => {
    useTempDataDir();
    await initAuth('correct-horse');
    const original = loadAuthConfig();
    expect(original).not.toBeNull();

    const notice = await initAuthFromHandover({
      passwordHash: original!.passwordHash,
      credentialKey: original!.credentialKey,
      sessionSecret: original!.sessionSecret,
    });
    expect(notice).toContain('handed over');
    const restored = loadAuthConfig();
    expect(restored?.credentialKey).toBe(original!.credentialKey);
    expect(restored?.sessionSecret).toBe(original!.sessionSecret);
  });

  test('a session issued before the handover still verifies after it', async () => {
    useTempDataDir();
    await initAuth('correct-horse');
    const original = loadAuthConfig()!;
    const token = issueSessionToken({
      sessionSecret: original.sessionSecret,
      credentialKey: original.credentialKey,
      ttlMs: SESSION_TTL_MS,
    });

    await initAuthFromHandover({
      passwordHash: original.passwordHash,
      credentialKey: original.credentialKey,
      sessionSecret: original.sessionSecret,
    });

    // A restart must not sign the user out: this is the property the key +
    // secret pair exists to preserve.
    const response = authGate(new Request('http://localhost/api/folders', {
      headers: { cookie: `omp_session=${token}` },
    }));
    expect(response).toBeUndefined();
  });

  test('a payload carrying only a plaintext falls back to the normal path', async () => {
    useTempDataDir();
    const notice = await initAuthFromHandover({ password: 'correct-horse' });
    expect(notice).toContain('password from this run');
    expect(loadAuthConfig()).not.toBeNull();
  });

  test('an incomplete payload leaves authentication off rather than half-armed', async () => {
    useTempDataDir();
    // A hash with no key is not a credential; installing it would make every
    // request fail in a way nothing on screen explains.
    await initAuthFromHandover({ passwordHash: 'hash-only' });
    expect(loadAuthConfig()).toBeNull();
    expect(isAuthEnabled()).toBe(false);
  });
});
