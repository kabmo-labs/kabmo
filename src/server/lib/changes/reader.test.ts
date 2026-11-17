/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The journal reader: the net change of a run, the `+`/`−` counts, and the
 * fallback to omp's journal for a session that predates the feature.
 *
 * The net rule is the one the diff tab shows — the first record's `before` to
 * the last record's `after` — so a create-then-update reads as one added file,
 * not two writes.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { ChangeJournal } from '@/server/lib/changes/journal.server';
import { journalPath } from '@/server/lib/changes/paths.server';
import {
  readSessionChangeDiff,
  readSessionChangeIndex,
  readSessionChangeList,
  readSessionChangeStats,
} from '@/server/lib/changes/reader.server';
import { clearSessionFileCaches } from '@/server/lib/omp/session/files';

const SESSION = 'sess-read';
let dataDir = '';
let agentDir = '';
let originalData: string | undefined;
let originalAgent: string | undefined;

beforeAll(async () => {
  originalData = Bun.env.KABMO_DATA_DIR;
  originalAgent = Bun.env.PI_CODING_AGENT_DIR;
  dataDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'kabmo-changes-read-'));
  agentDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'kabmo-changes-agent-'));
  Bun.env.KABMO_DATA_DIR = dataDir;
  Bun.env.PI_CODING_AGENT_DIR = agentDir;
  clearSessionFileCaches();

  const journal = new ChangeJournal(SESSION, '/repo');
  await journal.recordChange({
    at: 100, runId: 'r-1', runAt: 90, agent: 'Main', tool: 'edit', op: 'create', path: '/repo/a.ts',
    displayPath: 'a.ts', before: null, after: 'A', source: 'tool',
  });
  await journal.recordChange({
    at: 200, agent: 'Main', tool: 'edit', op: 'update', path: '/repo/a.ts',
    displayPath: 'a.ts', before: 'A', after: 'B', source: 'tool',
  });
  await journal.recordChange({
    at: 300, agent: 'Main', tool: 'bash', op: 'delete', path: '/repo/b.ts',
    displayPath: 'b.ts', before: 'X', after: null, source: 'trace', command: 'rm b.ts', exit: 0,
  });
  await journal.recordChange({
    at: 400, agent: 'Main', tool: 'bash', op: 'update', path: path.join(os.tmpdir(), 'tmp.txt'),
    displayPath: 'tmp.txt', before: 'a', after: 'b', source: 'trace',
  });
  await journal.recordChange({
    at: 500, agent: 'Main', tool: 'bash', op: 'create', path: '/repo/dist/x.js',
    displayPath: 'dist/x.js', before: null, after: 'x', source: 'scan',
  });
  await journal.flush();
});

afterAll(async () => {
  if (originalData === undefined) delete Bun.env.KABMO_DATA_DIR;
  else Bun.env.KABMO_DATA_DIR = originalData;
  if (originalAgent === undefined) delete Bun.env.PI_CODING_AGENT_DIR;
  else Bun.env.PI_CODING_AGENT_DIR = originalAgent;
  clearSessionFileCaches();
  await fsp.rm(dataDir, { recursive: true, force: true });
  await fsp.rm(agentDir, { recursive: true, force: true });
});

describe('readSessionChangeIndex', () => {
  test('returns every record, oldest first, with display paths', async () => {
    const records = await readSessionChangeIndex(SESSION);
    expect(records.map((record) => record.displayPath)).toEqual(['a.ts', 'a.ts', 'b.ts']);
    expect(records[2]?.tool).toBe('bash');
  });
});

describe('temp paths', () => {
  test('a temp path is not listed', async () => {
    const records = await readSessionChangeIndex(SESSION);
    expect(records.some((record) => record.displayPath === 'tmp.txt')).toBe(false);
  });
});

describe('build paths', () => {
  test('a build path is not listed', async () => {
    const records = await readSessionChangeIndex(SESSION);
    expect(records.some((record) => record.displayPath === 'dist/x.js')).toBe(false);
  });
});

describe('run fields', () => {
  test('maps the run id and its start time', async () => {
    const records = await readSessionChangeIndex(SESSION);
    expect(records[0]?.runId).toBe('r-1');
    expect(records[0]?.runAt).toBe(90);
    expect(records[1]?.runId).toBeUndefined();
  });
});

describe('readSessionChangeList', () => {
  test('keeps a delete record instead of inferring it from the filesystem', async () => {
    const records = await readSessionChangeList(SESSION);
    expect(records.length).toBe(3);
    expect(records.some((record) => record.path === '/repo/b.ts')).toBe(true);
  });
});

describe('readSessionChangeDiff', () => {
  test('is the first before to the last after', async () => {
    const diff = await readSessionChangeDiff(SESSION, '/repo/a.ts', 0, 1000);
    expect(diff?.status).toBe('added');
    expect(diff?.oldContent).toBe('');
    expect(diff?.newContent).toBe('B');
    expect(diff?.unavailable).toBe(false);
    expect(diff?.diff).toContain('+B');
  });

  test('a deleted path has an empty after side', async () => {
    const diff = await readSessionChangeDiff(SESSION, '/repo/b.ts', 0, 1000);
    expect(diff?.status).toBe('deleted');
    expect(diff?.oldContent).toBe('X');
    expect(diff?.newContent).toBe('');
  });

  test('a path outside the window has no diff', async () => {
    expect(await readSessionChangeDiff(SESSION, '/repo/a.ts', 500, 1000)).toBeNull();
  });
});

describe('readSessionChangeStats', () => {
  test('counts the net pair, not each write', async () => {
    const stats = await readSessionChangeStats(SESSION, 0, 1000);
    expect(stats['/repo/a.ts']).toEqual({ added: 1, removed: 0 });
    expect(stats['/repo/b.ts']).toEqual({ added: 0, removed: 1 });
  });
});

describe('fallback', () => {
  test('a session with no Kabmo journal answers the omp reader (empty here)', async () => {
    expect(await readSessionChangeIndex('no-such-session')).toEqual([]);
  });
});

describe('torn line', () => {
  test('a partial final line does not hide the earlier records', async () => {
    await fsp.appendFile(journalPath(SESSION), '{"v":1,"type":"change"');
    const records = await readSessionChangeIndex(SESSION);
    expect(records.length).toBe(3);
  });
});
