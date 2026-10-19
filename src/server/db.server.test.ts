/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Where Kabmo decides its SQLite file lives.
 *
 * `getDatabasePath` has three branches and the ORDER between them is the whole
 * contract. The mock branch is cwd-relative by design (demo mode has no data
 * directory to speak of), which made it win over an explicit
 * `KABMO_DB_PATH` — so a `MOCK=true` server started from a checkout wrote
 * the repository's own `workspace.db`, and a caller that set the variable to
 * isolate itself was silently ignored. That is the same class of failure
 * `test-support/isolated-db.ts` documents for the unit layer, one level up: a
 * test or a second instance writes a database it does not own.
 *
 * Pinned here: the override wins in BOTH modes, `DB_PATH` is the fallback
 * spelling, `~` expands, the directory is created, and the two defaults are
 * still what they were (cwd-relative `workspace.db` in mock, `~/.kabmo`
 * otherwise). `getDatabasePath` is read per call, so no handle is opened and
 * the real database is never touched.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import * as path from 'node:path';

import { getDatabasePath } from '@/server/db.server';
import { removeDir } from '@/test-support/remove-dir';

const saved = {
  mock: Bun.env.MOCK,
  dbPath: Bun.env.KABMO_DB_PATH,
  legacyDbPath: Bun.env.OMPCHAMBER_DB_PATH,
  bareDbPath: Bun.env.DB_PATH,
};
const roots: string[] = [];

function tempRoot(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'omc-db-path-'));
  roots.push(dir);
  return dir;
}

beforeEach(() => {
  delete Bun.env.MOCK;
  delete Bun.env.KABMO_DB_PATH;
  delete Bun.env.OMPCHAMBER_DB_PATH;
  delete Bun.env.DB_PATH;
});

afterEach(() => {
  for (const [key, value] of Object.entries({
    MOCK: saved.mock,
    KABMO_DB_PATH: saved.dbPath,
    OMPCHAMBER_DB_PATH: saved.legacyDbPath,
    DB_PATH: saved.bareDbPath,
  })) {
    if (value === undefined) delete Bun.env[key];
    else Bun.env[key] = value;
  }
  for (const dir of roots.splice(0)) removeDir(dir);
});

describe('getDatabasePath', () => {
  test('an explicit override beats the mock default', async () => {
    Bun.env.MOCK = 'true';
    const target = path.join(tempRoot(), 'nested', 'isolated.sqlite');
    Bun.env.KABMO_DB_PATH = target;

    expect(await getDatabasePath()).toBe(target);
    // The parent is created, not just named — a path whose directory is
    // missing is one `createDb` cannot open.
    expect(existsSync(path.dirname(target))).toBe(true);
  });

  test('an explicit override beats the real default too', async () => {
    const target = path.join(tempRoot(), 'real.sqlite');
    Bun.env.KABMO_DB_PATH = target;

    expect(await getDatabasePath()).toBe(target);
  });

  test('DB_PATH is the fallback spelling, and KABMO_DB_PATH wins over it', async () => {
    const legacy = path.join(tempRoot(), 'legacy.sqlite');
    Bun.env.DB_PATH = legacy;
    expect(await getDatabasePath()).toBe(legacy);

    const preferred = path.join(tempRoot(), 'preferred.sqlite');
    Bun.env.KABMO_DB_PATH = preferred;
    expect(await getDatabasePath()).toBe(preferred);
  });

  test('KABMO_DB_PATH wins over both pre-rename spellings', async () => {
    Bun.env.DB_PATH = path.join(tempRoot(), 'oldest.sqlite');
    Bun.env.KABMO_DB_PATH = path.join(tempRoot(), 'old.sqlite');
    const renamed = path.join(tempRoot(), 'new.sqlite');
    Bun.env.KABMO_DB_PATH = renamed;

    expect(await getDatabasePath()).toBe(renamed);
  });

  test('a leading ~ expands to the home directory', async () => {
    Bun.env.KABMO_DB_PATH = '~/.kabmo-e2e-probe/x.sqlite';
    expect(await getDatabasePath()).toBe(path.join(homedir(), '.kabmo-e2e-probe', 'x.sqlite'));
    rmSync(path.join(homedir(), '.kabmo-e2e-probe'), { recursive: true, force: true });
  });

  test('mock with no override stays cwd-relative workspace.db', async () => {
    Bun.env.MOCK = 'true';
    expect(await getDatabasePath()).toBe(path.join(process.cwd(), 'workspace.db'));
  });

  test('real mode with no override stays the home data directory', async () => {
    expect(await getDatabasePath()).toBe(path.join(homedir(), '.kabmo', 'db.sqlite'));
  });
});
