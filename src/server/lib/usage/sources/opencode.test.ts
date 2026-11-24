/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The OpenCode database reader.
 *
 * v1 (`message`) and v2 (`session_message`) can both hold a migrated session.
 * The v2 row wins, or every migrated turn is counted twice; cost is the
 * provider's own number, and a zero-cost turn is unpriced rather than free.
 */

import { Database } from 'bun:sqlite';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';

import { opencodeRowsFromPath } from '@/server/lib/usage/sources/opencode.server';
import { removeDir } from '@/test-support/remove-dir';

let dir = '';
let path = '';

beforeAll(() => {
  dir = fs.mkdtempSync(join(os.tmpdir(), 'kabmo-opencode-'));
  path = join(dir, 'opencode.db');
  const db = new Database(path);
  db.exec(`
    CREATE TABLE session (id TEXT PRIMARY KEY, directory TEXT);
    CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, data TEXT);
    CREATE TABLE session_message (id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, type TEXT, data TEXT);
  `);
  db.run('INSERT INTO session (id, directory) VALUES (?, ?)', ['both', '/Users/dev/projects/kabmo']);
  db.run('INSERT INTO session (id, directory) VALUES (?, ?)', ['v1', '/Users/dev/projects/omp']);
  // A migrated session: the v1 row must not be read while v2 has a row.
  db.run('INSERT INTO message (id, session_id, time_created, data) VALUES (?, ?, ?, ?)', [
    'm-v1',
    'both',
    1795000000000,
    JSON.stringify({
      role: 'assistant',
      cost: 9,
      tokens: { input: 1, output: 1, cache: { read: 0, write: 0 } },
      modelID: 'old-model',
      providerID: 'opencode',
    }),
  ]);
  db.run('INSERT INTO session_message (id, session_id, time_created, type, data) VALUES (?, ?, ?, ?, ?)', [
    'm-v2',
    'both',
    1795000000000,
    'assistant',
    JSON.stringify({
      model: { providerID: 'kenari', id: 'deepseek-v4' },
      cost: 0.25,
      tokens: { input: 10, output: 5, reasoning: 2, cache: { read: 100, write: 3 } },
      time: { created: 1795000000000 },
    }),
  ]);
  db.run('INSERT INTO message (id, session_id, time_created, data) VALUES (?, ?, ?, ?)', [
    'm-v1b',
    'v1',
    1795000000000,
    JSON.stringify({
      role: 'assistant',
      cost: 1,
      tokens: { input: 4, output: 2, cache: { read: 40, write: 0 } },
      modelID: 'deepseek-v4',
      providerID: 'kenari',
    }),
  ]);
  db.close();
});

afterAll(() => {
  removeDir(dir);
});

describe('opencodeRowsFromPath', () => {
  test('reads the v2 row for a migrated session and the v1 row for the rest', () => {
    const folded = opencodeRowsFromPath(path);
    expect(folded).not.toBeNull();
    const rows = [...(folded ?? new Map()).values()];
    expect(rows).toHaveLength(2);
    const migrated = rows.find((row) => row.project === 'kabmo');
    const legacy = rows.find((row) => row.project === 'omp');
    expect(migrated?.provider).toBe('kenari');
    expect(migrated?.model).toBe('deepseek-v4');
    expect(migrated?.records).toBe(1);
    expect(migrated?.costTotal).toBe(0.25);
    expect(migrated?.input).toBe(10);
    expect(migrated?.cacheRead).toBe(100);
    expect(legacy?.model).toBe('deepseek-v4');
    expect(legacy?.costTotal).toBe(1);
  });

  test('an unreadable database is null, not an empty period', () => {
    // Committing an empty map would DELETE the rows a chat already contributed;
    // a locked or corrupt store must leave the index alone.
    expect(opencodeRowsFromPath(join(dir, 'absent.db'))).toBeNull();
  });
});
