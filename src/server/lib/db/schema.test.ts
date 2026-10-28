/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Auth state on disk, the caller address, and Kabmo database.
 *
 * The auth file holds ONE thing: a session-signing secret. A stored
 * `passwordHash` from the retired v1 shape must be readable for its secret but
 * must never enable authentication — a file on disk cannot decide that a server
 * the user started needs a credential they never set. The secret itself must
 * survive a restart (a `bun run --hot` reload would otherwise log the user out
 * on every save), so the write/read round-trip and the 0600 mode are pinned.
 *
 * The database tests open a REAL `bun:sqlite` file in a temp directory and
 * bootstrap it twice: the migrations run on every open, so a second run must be
 * a no-op. The pragmas are pinned because they are the difference between a
 * shared database that waits for its writer and one that fails with
 * `SQLITE_BUSY` on every contended write.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { hashPassword, readSessionSecret, verifyPassword, writeSessionSecret } from '@/server/lib/auth/config';
import { clientAddressFor, rememberClientAddress } from '@/server/lib/auth/client-address';
import { UNKNOWN_CLIENT_KEY } from '@/server/lib/auth/rate-limit';
import { getAuthPath } from '@/server/lib/lifecycle/paths';
import { createDb } from '@/server/lib/db/client';
import { removeDir } from '@/test-support/remove-dir';
import { initSchema } from '@/server/lib/db/schema';

let workRoot = '';
let originalDataDir: string | undefined;

beforeAll(() => {
  workRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kabmo-auth-db-test-'));
  originalDataDir = Bun.env.KABMO_DATA_DIR;
  Bun.env.KABMO_DATA_DIR = workRoot;
});

/** Every connection this file opened, closed before the directory is deleted. */
const opened: Array<{ close(): void }> = [];

afterAll(() => {
  if (originalDataDir === undefined) delete Bun.env.KABMO_DATA_DIR;
  else Bun.env.KABMO_DATA_DIR = originalDataDir;
  for (const db of opened.splice(0)) db.close();
  removeDir(workRoot);
});

afterEach(() => {
  // Close, then delete. On Windows an open SQLite handle makes the delete fail
  // with EBUSY, and a throw from `afterEach` reports the PREVIOUS test as failed
  // — measured on the first Windows run, where all eight cases here failed on
  // the teardown of the one before.
  for (const db of opened.splice(0)) db.close();
  removeDir(workRoot);
  fs.mkdirSync(workRoot, { recursive: true });
});

describe('session secret persistence', () => {
  test('a missing or malformed file means "no secret to reuse"', async () => {
    // Absent, unreadable and malformed all mean the same thing: generate a
    // fresh secret, which is a logout rather than a boot failure.
    expect(await readSessionSecret()).toBeNull();
    fs.writeFileSync(getAuthPath(), '{ not json');
    expect(await readSessionSecret()).toBeNull();
    fs.writeFileSync(getAuthPath(), '"a string"');
    expect(await readSessionSecret()).toBeNull();
    fs.writeFileSync(getAuthPath(), JSON.stringify({ version: 2, sessionSecret: '' }));
    expect(await readSessionSecret()).toBeNull();
  });

  test('writes version 2 at 0600 and reads the secret back', async () => {
    expect(await writeSessionSecret('fixture-secret')).toBe(true);
    const raw = JSON.parse(fs.readFileSync(getAuthPath(), 'utf8'));
    expect(raw.version).toBe(2);
    expect(raw.sessionSecret).toBe('fixture-secret');
    expect(typeof raw.updatedAt).toBe('string');
    // Windows has no POSIX permission bits: `statSync().mode` reports a
    // synthesised 0o666, so the 0600 claim is only meaningful on POSIX. The
    // write/read round-trip above is the portable half of this case.
    if (process.platform !== 'win32') {
      expect(fs.statSync(getAuthPath()).mode & 0o777).toBe(0o600);
    }
    expect(await readSessionSecret()).toBe('fixture-secret');
  });

  test('reuses the retired v1 secret but never its password hash', async () => {
    // Upgrading must not sign every logged-in user out, and a hash that an old
    // install persisted must not become a credential this run honors.
    fs.writeFileSync(getAuthPath(), JSON.stringify({
      version: 1,
      passwordHash: '$argon2id$v=19$m=65536,t=2,p=1$fixture$fixture',
      sessionSecret: 'legacy-secret',
    }));
    expect(await readSessionSecret()).toBe('legacy-secret');
  });

  test('hashes with argon2id and verifies only the matching password', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(await verifyPassword('correct horse battery staple', hash)).toBe(true);
    expect(await verifyPassword('wrong password', hash)).toBe(false);
  });
});

describe('client address', () => {
  test('an unrecorded request falls back to the shared unknown key', () => {
    // A shared key (not per-request randomness) is what keeps an
    // unidentifiable caller drawing from the small shared rate-limit budget.
    expect(clientAddressFor(new Request('http://localhost/api/health'))).toBe(UNKNOWN_CLIENT_KEY);
  });

  test('records the socket address against the exact Request', () => {
    const request = new Request('http://localhost/api/login', { method: 'POST' });
    rememberClientAddress(request, '203.0.113.7');
    expect(clientAddressFor(request)).toBe('203.0.113.7');
    // The entry is per Request: a different one is still unknown.
    expect(clientAddressFor(new Request('http://localhost/api/login'))).toBe(UNKNOWN_CLIENT_KEY);
  });

  test('an absent or empty address is stored as unknown', () => {
    for (const value of [undefined, '']) {
      const request = new Request('http://localhost/api/login');
      rememberClientAddress(request, value);
      expect(clientAddressFor(request)).toBe(UNKNOWN_CLIENT_KEY);
    }
  });
});

describe('database client', () => {
  async function freshDb(name: string) {
    const db = createDb(path.join(workRoot, `${name}.sqlite`));
    opened.push(db.raw);
    return db;
  }

  test('opens with the pragmas a shared database needs', async () => {
    const db = await freshDb('pragmas');
    expect((await db.get<{ journal_mode: string }>('PRAGMA journal_mode'))?.journal_mode).toBe('wal');
    expect((await db.get<{ foreign_keys: number }>('PRAGMA foreign_keys'))?.foreign_keys).toBe(1);
    // A blocked write waits instead of failing on the spot with SQLITE_BUSY.
    expect((await db.get<{ timeout: number }>('PRAGMA busy_timeout'))?.timeout).toBe(2000);
  });

  test('run reports changes and the last inserted row id', async () => {
    const db = await freshDb('run');
    await db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT, v TEXT)');
    expect(await db.run('INSERT INTO t (v) VALUES (?)', ['a'])).toEqual({ changes: 1, lastID: 1 });
    expect(await db.run('INSERT INTO t (v) VALUES (?)', ['b'])).toEqual({ changes: 1, lastID: 2 });
    expect(await db.run('UPDATE t SET v = ? WHERE v = ?', ['b', 'a'])).toEqual({ changes: 1, lastID: 2 });
    expect(await db.run('DELETE FROM t WHERE v = ?', ['nothing'])).toEqual({ changes: 0, lastID: 2 });
  });

  test('get, all and exec read and write the same connection', async () => {
    const db = await freshDb('query');
    await db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT, v TEXT)');
    await db.run('INSERT INTO t (v) VALUES (?)', ['a']);
    await db.exec("INSERT INTO t (v) VALUES ('b')");
    expect(await db.get<{ v: string }>('SELECT v FROM t WHERE id = ?', [1])).toEqual({ v: 'a' });
    // bun:sqlite's `get()` answers `null` for no row and the client passes it
    // through, even though the `DbClient` signature declares `T | undefined`
    // (reported as a source/type mismatch — these tests pin the behavior that
    // actually ships, so a caller written against either spelling is warned).
    expect(await db.get('SELECT v FROM t WHERE id = ?', [99])).toBeNull();
    expect(await db.all<{ v: string }>('SELECT v FROM t ORDER BY id')).toEqual([{ v: 'a' }, { v: 'b' }]);
  });

  test('enforces foreign keys and names no rows for an empty table', async () => {
    const db = await freshDb('fk');
    await db.exec('CREATE TABLE parent (id INTEGER PRIMARY KEY)');
    await db.exec('CREATE TABLE child (id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES parent (id))');
    await expect(db.run('INSERT INTO child (parent_id) VALUES (?)', [1])).rejects.toThrow();
    expect(await db.all('SELECT * FROM child')).toEqual([]);
  });
});

describe('schema bootstrap', () => {
  test('creates Kabmo tables and is idempotent', async () => {
    const db = createDb(path.join(workRoot, 'schema.sqlite'));
    opened.push(db.raw);
    await initSchema(db);
    const tableNames = async () => (await db.all<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    )).map((row) => row.name);

    const first = await tableNames();
    for (const expected of [
      'workspace_folders', 'sessions', 'app_settings', 'chat_sessions', 'deleted_workspaces',
      'archived_sessions', 'session_ui_state', 'queued_messages', 'session_stream_state',
      'files', 'btw_topics', 'btw_turns', 'scheduled_tasks', 'scheduled_task_runs',
      'waiting_prompts',
    ]) {
      expect(first).toContain(expected);
    }

    // Migrations run on every open; a second bootstrap must change nothing and
    // must not fail on already-applied columns or tables.
    await initSchema(db);
    expect(await tableNames()).toEqual(first);
  });

  test('a second connection to the same file sees the same schema', async () => {
    const file = path.join(workRoot, 'shared.sqlite');
    const first = createDb(file);
    opened.push(first.raw);
    await initSchema(first);
    await first.run("INSERT INTO app_settings (key, value) VALUES ('k', 'v')");

    const second = createDb(file);
    opened.push(second.raw);
    expect(await second.get<{ value: string }>("SELECT value FROM app_settings WHERE key = 'k'")).toEqual({ value: 'v' });
    expect(await second.get<{ name: string }>("SELECT name FROM sqlite_master WHERE name = 'files'")).toEqual({ name: 'files' });
  });
});
