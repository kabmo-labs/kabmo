/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The leftover edges of the omp bridge: the telemetry content profiler whose
 * badges the raw-messages panel renders, the additive column migration, the
 * generated UI password, the synchronous transaction wrapper, and the persisted
 * access-mode read. Each is small but each fails user-visibly: a profiler that
 * mislabels a tool, a migration that aborts startup, a transaction that commits
 * a failed write. The prewarm trigger and its cwd resolution have their own
 * file (`prewarm.test.ts`).
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { removeDir } from '@/test-support/remove-dir';

import { GENERATED_PASSWORD_LENGTH, PASSWORD_ALPHABET, UI_PASSWORD_ENV, generatePassword } from '@/shared/lib/auth/password';
import { withTransaction } from '@/shared/lib/db/transaction.server';
import { loadPersistedAccessMode } from '@/shared/lib/omp/config/access-mode.server';
import { ACCESS_MODE_SETTING_KEY, DEFAULT_APPROVAL_MODE } from '@/shared/lib/omp/config/access-mode';
import { TYPE_ORDER, contentProfile } from '@/shared/lib/omp/session/telemetry-blocks';
import { migrateSessionStreamStateColumns } from '@/shared/lib/omp/session/schema-migrations';
import { createDb } from '@/server/lib/db/client';
import { hashPassword, verifyPassword } from '@/server/lib/auth/config';
import { getDb } from '@/server/db.server';

describe('contentProfile', () => {
  test('the badge order is fixed', () => {
    expect(TYPE_ORDER).toEqual(['reasoning', 'text', 'bash', 'read', 'edit', 'search', 'web', 'tool']);
  });

  test('a plain string is text, blank strings are nothing', () => {
    expect(contentProfile('hello')).toEqual({ parts: ['text'], toolCalls: 0, toolChars: 0 });
    expect(contentProfile('   ')).toEqual({ parts: [], toolCalls: 0, toolChars: 0 });
    expect(contentProfile(undefined)).toEqual({ parts: [], toolCalls: 0, toolChars: 0 });
  });

  test('block types map to their badges, in TYPE_ORDER not arrival order', () => {
    const profile = contentProfile([
      { type: 'toolCall', name: 'read_file', arguments: { path: '/x' } },
      { type: 'thinking', thinking: 'hmm' },
      { type: 'text', text: 'hi' },
    ]);
    expect(profile.parts).toEqual(['reasoning', 'text', 'read']);
    expect(profile.toolCalls).toBe(1);
    expect(profile.toolChars).toBe(JSON.stringify({ path: '/x' }).length);
  });

  test('tool names pick the coarse category by keyword', () => {
    const name = (tool: string) => contentProfile([{ type: 'toolCall', name: tool, arguments: {} }]).parts[0];
    expect(name('bash')).toBe('bash');
    expect(name('run_command')).toBe('bash');
    expect(name('write_file')).toBe('edit');
    expect(name('apply_patch')).toBe('edit');
    expect(name('read_file')).toBe('read');
    expect(name('web_search')).toBe('search');
    expect(name('fetch_url')).toBe('web');
    expect(name('mystery_tool')).toBe('tool');
    expect(name(undefined as unknown as string)).toBe('tool');
  });

  test('toolResults, commands and code all count toward toolChars', () => {
    const result = { type: 'toolResult', content: 'ok' };
    expect(contentProfile([result]).toolChars).toBe(JSON.stringify(result).length);
    expect(contentProfile([{ type: 'text', command: 'ls -la' }])).toMatchObject({ parts: ['text', 'bash'], toolChars: 6 });
    expect(contentProfile([{ type: 'text', code: 'x = 1' }]).toolChars).toBe(5);
  });

  test('malformed blocks are skipped without throwing', () => {
    const circular: Record<string, unknown> = { type: 'toolCall', name: 'bash' };
    circular.arguments = circular;
    expect(contentProfile([null, 'nope', 42, circular])).toEqual({ parts: ['bash'], toolCalls: 1, toolChars: 0 });
  });
});

describe('migrateSessionStreamStateColumns', () => {
  test('issues the additive owner, provider, and model columns', async () => {
    const statements: string[] = [];
    await migrateSessionStreamStateColumns({ exec: async (sql: string) => { statements.push(sql); } } as never);
    expect(statements).toEqual([
      'ALTER TABLE session_stream_state ADD COLUMN owner_pid INTEGER;',
      'ALTER TABLE session_stream_state ADD COLUMN model_provider TEXT;',
      'ALTER TABLE session_stream_state ADD COLUMN model_id TEXT;',
    ]);
  });

  test('an already-present column is not an error', async () => {
    // A fresh install gets the column from the DDL; the ALTER throws there and
    // the migration must still resolve, having issued each statement once.
    let attempts = 0;
    await migrateSessionStreamStateColumns({
      exec: async () => { attempts += 1; throw new Error('duplicate column name: owner_pid'); },
    } as never);
    expect(attempts).toBe(3);
  });
});

describe('generatePassword', () => {
  test('the alphabet is the 55 unambiguous characters', () => {
    expect(PASSWORD_ALPHABET).toBe('ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789');
    expect(PASSWORD_ALPHABET).toHaveLength(55);
    expect(PASSWORD_ALPHABET).not.toMatch(/[IOil01o]/);
    expect(UI_PASSWORD_ENV).toBe('KABMO_UI_PASSWORD');
    expect(GENERATED_PASSWORD_LENGTH).toBe(16);
  });

  test('a default password is 16 alphabet characters, and two differ', () => {
    const first = generatePassword();
    expect(first).toHaveLength(GENERATED_PASSWORD_LENGTH);
    expect([...first].every((char) => PASSWORD_ALPHABET.includes(char))).toBe(true);
    expect(generatePassword()).not.toBe(first);
  });

  test('an explicit length is honoured, floats floored', () => {
    expect(generatePassword(1)).toHaveLength(1);
    expect(generatePassword(64)).toHaveLength(64);
    expect(generatePassword(7.9)).toHaveLength(7);
  });

  test('a nonsensical length falls back to the default', () => {
    expect(generatePassword(0)).toHaveLength(GENERATED_PASSWORD_LENGTH);
    expect(generatePassword(-3)).toHaveLength(GENERATED_PASSWORD_LENGTH);
    expect(generatePassword(Number.NaN)).toHaveLength(GENERATED_PASSWORD_LENGTH);
    expect(generatePassword(Number.POSITIVE_INFINITY)).toHaveLength(GENERATED_PASSWORD_LENGTH);
  });
});

describe('withTransaction', () => {
  const dir = mkdtempSync(join(tmpdir(), 'omp-tx-'));
  const db = createDb(join(dir, 'tx.sqlite'));

  beforeAll(async () => {
    await db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, value TEXT NOT NULL)');
  });

  afterAll(() => {
    db.raw.close();
    removeDir(dir);
  });

  test('commits on success and returns the callback value', async () => {
    const returned = withTransaction(db, () => {
      db.raw.exec("INSERT INTO t (value) VALUES ('kept')");
      return 'result';
    });
    expect(returned).toBe('result');
    expect(await db.get<{ value: string }>('SELECT value FROM t WHERE value = ?', ['kept'])).toEqual({ value: 'kept' });
  });

  test('rolls back and rethrows when the callback throws', async () => {
    const failure = new Error('write failed');
    expect(() => withTransaction(db, () => {
      db.raw.exec("INSERT INTO t (value) VALUES ('discarded')");
      throw failure;
    })).toThrow(failure);
    expect(await db.get('SELECT value FROM t WHERE value = ?', ['discarded'])).toBeNull();
    // The connection is still usable after the rollback.
    expect(await db.all('SELECT value FROM t')).toEqual([{ value: 'kept' }]);
  });
});

describe('hashPassword / verifyPassword', () => {
  test('a hash verifies its own password and rejects a different one', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(await verifyPassword('correct horse battery staple', hash)).toBe(true);
    expect(await verifyPassword('correct horse battery stapl', hash)).toBe(false);
    expect(await verifyPassword('', hash)).toBe(false);
  });

  test('the same password hashes differently each run (salted)', async () => {
    const [first, second] = await Promise.all([hashPassword('same'), hashPassword('same')]);
    expect(first).not.toBe(second);
    expect(await verifyPassword('same', first)).toBe(true);
    expect(await verifyPassword('same', second)).toBe(true);
  });

  test('an empty stored hash reads as a wrong password, not a crash', async () => {
    // Reported separately: a NON-empty malformed hash throws on this runtime
    // rather than answering false (see bugsFound), so only the empty case is
    // pinned here.
    expect(await verifyPassword('anything', '')).toBe(false);
  });
});

describe('loadPersistedAccessMode', () => {
  const dir = mkdtempSync(join(tmpdir(), 'omp-access-'));
  const env = { path: Bun.env.KABMO_DB_PATH, db: Bun.env.DB_PATH, mock: Bun.env.MOCK, sync: Bun.env.SYNC_WORKSPACE };
  const slotKey = '__kabmoDb' as const;
  const savedSlot = (globalThis as Record<string, unknown>)[slotKey];

  beforeAll(() => {
    // The db handle is cached on globalThis across test files in one process;
    // drop any handle another file opened so this file opens its own temp db.
    (globalThis as Record<string, unknown>)[slotKey] = { promise: null, resolved: null };
    Bun.env.KABMO_DB_PATH = join(dir, 'access.sqlite');
    delete Bun.env.DB_PATH;
    delete Bun.env.MOCK;
    Bun.env.SYNC_WORKSPACE = 'false';
  });

  afterAll(() => {
    // CLOSE the handle this block opened through `getDb()` before restoring the
    // slot and deleting the tree; a bare slot restore abandons it, and Windows
    // then fails the delete with EBUSY on the still-open connection.
    globalThis.__kabmoDb?.resolved?.raw.close();
    (globalThis as Record<string, unknown>)[slotKey] = savedSlot;
    const restore = (key: 'KABMO_DB_PATH' | 'DB_PATH' | 'MOCK' | 'SYNC_WORKSPACE', value: string | undefined) => {
      if (value === undefined) delete Bun.env[key];
      else Bun.env[key] = value;
    };
    restore('KABMO_DB_PATH', env.path);
    restore('DB_PATH', env.db);
    restore('MOCK', env.mock);
    restore('SYNC_WORKSPACE', env.sync);
    removeDir(dir);
  });

  test('a missing row falls back to the default', async () => {
    expect(await loadPersistedAccessMode()).toBe(DEFAULT_APPROVAL_MODE);
  });

  test('reads the bare mode string the settings writer stores', async () => {
    // The generic writer stores non-objects with String(value): the row is
    // `yolo`, not `"yolo"`, so a JSON.parse would be wrong here.
    const db = await getDb();
    await db.run('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)', [ACCESS_MODE_SETTING_KEY, 'yolo']);
    expect(await loadPersistedAccessMode()).toBe('yolo');
    await db.run('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)', [ACCESS_MODE_SETTING_KEY, 'sudo']);
    expect(await loadPersistedAccessMode()).toBe(DEFAULT_APPROVAL_MODE);
  });

  test('any database error falls back to the default', async () => {
    const db = await getDb();
    await db.exec('ALTER TABLE app_settings RENAME TO app_settings_hidden');
    expect(await loadPersistedAccessMode()).toBe(DEFAULT_APPROVAL_MODE);
    await db.exec('ALTER TABLE app_settings_hidden RENAME TO app_settings');
  });
});
