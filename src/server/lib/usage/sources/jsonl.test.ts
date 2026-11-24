/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The shared omp-shaped JSONL reader behind Pi and OmO.
 *
 * The append path is the one that can silently double a bill: a tail read must
 * resume at the last complete line, and an unchanged file must be skipped by
 * the scanner (pinned in `index.test.ts`). Here the source itself is exercised
 * against a temp store, including the harness attribution.
 */

import { afterAll, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';

import { jsonlSource } from '@/server/lib/usage/sources/jsonl.server';
import { removeDir } from '@/test-support/remove-dir';

const dir = fs.mkdtempSync(join(os.tmpdir(), 'kabmo-jsonl-source-'));
const root = join(dir, 'sessions');
fs.mkdirSync(join(root, 'kabmo'), { recursive: true });

afterAll(() => {
  removeDir(dir);
});

const line = (cost: number): string => JSON.stringify({
  type: 'message',
  timestamp: '2026-11-20T10:00:00.000Z',
  message: {
    role: 'assistant',
    provider: 'kenari',
    model: 'deepseek-v4',
    usage: { input: 1, output: 1, totalTokens: 2, cost: { total: cost } },
  },
});

describe('jsonlSource', () => {
  test('lists, folds and tails an omp-shaped store under its own harness', async () => {
    const path = join(root, 'kabmo', 'one.jsonl');
    fs.writeFileSync(path, `${line(1)}\n`);
    const source = jsonlSource({ id: 'pi', harness: 'pi', root: () => root });

    const files = await source.list();
    expect(files).toHaveLength(1);
    expect(files[0].harness).toBe('pi');
    expect(files[0].project).toBe('kabmo');

    const first = await source.read(files[0], null);
    expect(first?.append).toBe(false);
    expect([...(first?.rows.values() ?? [])][0]?.harness).toBe('pi');
    expect([...(first?.rows.values() ?? [])][0]?.costTotal).toBe(1);

    const before = await source.list();
    fs.appendFileSync(path, `${line(2)}\n`);
    const after = await source.list();
    const next = await source.read(after[0], {
      session_file: after[0].key,
      source: 'pi',
      harness: 'pi',
      offset: first?.nextOffset ?? 0,
      size: before[0].size,
      mtime_ms: before[0].mtimeMs,
    });
    expect(next?.append).toBe(true);
    expect([...(next?.rows.values() ?? [])][0]?.costTotal).toBe(2);
  });
});
