/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The zcode database reader.
 *
 * `model_usage` is the per-request table (provider, model, token split);
 * `turn_usage` is the same tokens aggregated without a provider. Reading both
 * would double every number, so only `model_usage` is indexed.
 */

import { Database } from 'bun:sqlite';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';

import { zcodeRowsFromPath } from '@/server/lib/usage/sources/zcode.server';
import { removeDir } from '@/test-support/remove-dir';

let dir = '';
let path = '';

beforeAll(() => {
  dir = fs.mkdtempSync(join(os.tmpdir(), 'kabmo-zcode-'));
  path = join(dir, 'db.sqlite');
  const db = new Database(path);
  db.exec(`
    CREATE TABLE session (id TEXT PRIMARY KEY, directory TEXT);
    CREATE TABLE turn_usage (session_id TEXT, input_tokens INTEGER, output_tokens INTEGER);
    CREATE TABLE model_usage (
      session_id TEXT,
      provider_id TEXT,
      model_id TEXT,
      input_tokens INTEGER,
      output_tokens INTEGER,
      reasoning_tokens INTEGER,
      cache_creation_input_tokens INTEGER,
      cache_read_input_tokens INTEGER,
      computed_total_tokens INTEGER,
      started_at INTEGER
    );
  `);
  db.run('INSERT INTO session (id, directory) VALUES (?, ?)', ['s1', '/Users/dev/projects/kabmo']);
  db.run('INSERT INTO turn_usage (session_id, input_tokens, output_tokens) VALUES (?, ?, ?)', ['s1', 999, 999]);
  db.run(
    `INSERT INTO model_usage
       (session_id, provider_id, model_id, input_tokens, output_tokens, reasoning_tokens,
        cache_creation_input_tokens, cache_read_input_tokens, computed_total_tokens, started_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ['s1', 'kenari', 'qwen3-8-27b:free', 20, 5, 2, 3, 100, 130, 1795000000000],
  );
  db.close();
});

afterAll(() => {
  removeDir(dir);
});

describe('zcodeRowsFromPath', () => {
  test('counts model_usage once and attributes provider/model/project', () => {
    const folded = zcodeRowsFromPath(path);
    expect(folded).not.toBeNull();
    const rows = [...(folded ?? new Map()).values()];
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.harness).toBe('zcode');
    expect(row.project).toBe('kabmo');
    expect(row.provider).toBe('kenari');
    expect(row.model).toBe('qwen3-8-27b:free');
    expect(row.records).toBe(1);
    expect(row.input).toBe(20);
    expect(row.output).toBe(5);
    expect(row.reasoning).toBe(2);
    expect(row.cacheWrite).toBe(3);
    expect(row.cacheRead).toBe(100);
    expect(row.total).toBe(130);
    expect(row.costTotal).toBe(0);
    expect(row.unpriced).toBe(1);
  });

  test('an unreadable database is null, not an empty period', () => {
    expect(zcodeRowsFromPath(join(dir, 'absent.db'))).toBeNull();
  });
});
