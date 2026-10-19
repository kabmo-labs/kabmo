/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The credential a login entry reads.
 *
 * The exposure this closes: a login entry is a world-readable command line
 * (plist 0644, `.desktop`, Run value) that outlives the run which wrote it, so
 * the secret cannot live in it. It lives in a 0600 file instead, and the entry
 * names the path.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  getAutostartCredentialPath,
  readAutostartCredential,
  removeAutostartCredential,
  writeAutostartCredential,
} from '@/server/lib/tray/credential';
import { testPosix } from '@/test-support/platform';

let tempDir = '';
let originalDataDir: string | undefined;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kabmo-credential-test-'));
  originalDataDir = Bun.env.KABMO_DATA_DIR;
  Bun.env.KABMO_DATA_DIR = tempDir;
});

afterEach(() => {
  if (originalDataDir === undefined) delete Bun.env.KABMO_DATA_DIR;
  else Bun.env.KABMO_DATA_DIR = originalDataDir;
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('autostart credential', () => {
  test('round-trips a password', () => {
    expect(writeAutostartCredential('s3cret-value')).toBe(true);
    expect(readAutostartCredential()).toBe('s3cret-value');
  });

  // The whole reason this file exists rather than a flag in the entry.
  testPosix('is written 0600, including over a wider pre-existing file', () => {
    fs.mkdirSync(tempDir, { recursive: true });
    fs.writeFileSync(getAutostartCredentialPath(), 'old', { mode: 0o644 });
    writeAutostartCredential('new');
    expect(fs.statSync(getAutostartCredentialPath()).mode & 0o777).toBe(0o600);
  });

  test('a missing or blank file reads as no credential', () => {
    expect(readAutostartCredential()).toBeNull();
    writeAutostartCredential('   ');
    expect(readAutostartCredential()).toBeNull();
  });

  test('removal leaves nothing behind, and is safe to repeat', () => {
    writeAutostartCredential('gone');
    removeAutostartCredential();
    expect(readAutostartCredential()).toBeNull();
    expect(() => removeAutostartCredential()).not.toThrow();
  });

  test('the path sits in the data directory, beside auth.json', () => {
    // Same directory as the other 0600 state, so one backup/removal covers it.
    expect(getAutostartCredentialPath().startsWith(tempDir)).toBe(true);
  });
});
