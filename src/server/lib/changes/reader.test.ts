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
import { clearSessionFileCaches } from '@kabmo-labs/kabmo-omp/session-scan/files';

const SESSION = 'sess-read';
/** A session whose only journal is omp 19's, so the merge has no Kabmo half. */
const PATCH_SESSION = 'sess-patch-omp';
let patchPath = '';
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

  const gone = new ChangeJournal('sess-gone', '/repo');
  await gone.recordChange({
    at: 1, agent: 'Main', tool: 'write', op: 'create', path: '/repo/gone.ts',
    displayPath: 'gone.ts', before: null, after: 'x', source: 'tool',
  });
  await gone.recordChange({
    at: 2, agent: 'Main', tool: 'bash', op: 'delete', path: '/repo/gone.ts',
    displayPath: 'gone.ts', before: 'x', after: null, source: 'trace',
  });
  await gone.flush();

  // omp 19's journal: hunks, no blob keys. The file exists on disk, as it does
  // in a real session, so the list's "creation whose file is gone" rule keeps it.
  const patchCwd = path.join(agentDir, 'patch-project');
  await fsp.mkdir(patchCwd, { recursive: true });
  patchPath = path.join(patchCwd, 'history.md');
  const patchText = '## 09:12\n\n- **Outcome**: success\n';
  await fsp.writeFile(patchPath, patchText);
  const cwdDir = path.join(agentDir, 'sessions', '-patch-project');
  await fsp.mkdir(cwdDir, { recursive: true });
  const sessionFile = path.join(cwdDir, `2026-01-01T00-00-00-000Z_${PATCH_SESSION}.jsonl`);
  await fsp.writeFile(sessionFile, `${JSON.stringify({ type: 'session', id: PATCH_SESSION, cwd: patchCwd })}\n`);
  const ompDir = sessionFile.slice(0, -'.jsonl'.length);
  await fsp.mkdir(path.join(ompDir, 'blobs'), { recursive: true });
  await fsp.writeFile(path.join(ompDir, 'changes.jsonl'), `${JSON.stringify({
    type: 'change', at: 10, agent: 'Main', tool: 'bash', path: patchPath,
    base: null, edit: [[0, 0, patchText.split('\n')]], sum: Bun.hash(patchText).toString(36),
  })}\n`);
  clearSessionFileCaches();
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

describe('net-zero paths', () => {
  test('a create-then-delete path is not listed', async () => {
    expect(await readSessionChangeList('sess-gone')).toEqual([]);
    expect((await readSessionChangeIndex('sess-gone')).length).toBe(2);
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

  test('drops a path that is a directory, recorded before the writer skipped them', async () => {
    const bin = path.join(dataDir, 'bin');
    await fsp.mkdir(bin, { recursive: true });
    const journal = new ChangeJournal('sess-dir', dataDir);
    await journal.recordChange({
      at: 10, agent: 'Main', tool: 'bash', op: 'delete', path: bin,
      displayPath: 'bin', before: undefined, after: null, source: 'trace', unavailableReason: 'snapshot-race',
    });
    await journal.flush();
    expect(await readSessionChangeList('sess-dir')).toEqual([]);
    expect((await readSessionChangeIndex('sess-dir')).length).toBe(1);
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

describe('unavailable sides', () => {
  test('a snapshot race names itself and carries no cap', async () => {
    const journal = new ChangeJournal('sess-race', '/repo');
    await journal.recordChange({
      at: 10, agent: 'Main', tool: 'write', op: 'update', path: '/repo/race.ts',
      displayPath: 'race.ts', before: undefined, after: 'new', source: 'tool', unavailableReason: 'snapshot-race',
    });
    await journal.flush();
    const diff = await readSessionChangeDiff('sess-race', '/repo/race.ts', 0, 100);
    expect(diff?.unavailable).toBe(true);
    expect(diff?.unavailableReason).toBe('snapshot-race');
    expect(diff?.unavailableLimitBytes).toBeUndefined();
  });

  test('a side over the cap reports the Kabmo limit', async () => {
    const journal = new ChangeJournal('sess-large', '/repo');
    await journal.recordChange({
      at: 10, agent: 'Main', tool: 'edit', op: 'update', path: '/repo/large.ts',
      displayPath: 'large.ts', before: undefined, after: 'new', source: 'tool',
    });
    await journal.flush();
    const diff = await readSessionChangeDiff('sess-large', '/repo/large.ts', 0, 100);
    expect(diff?.unavailableReason).toBe('too-large');
    expect(diff?.unavailableLimitBytes).toBe(32 * 1024 * 1024);
  });

  test('a stored key whose blob is gone is missing, not over-cap', async () => {
    const file = journalPath('sess-missing');
    await fsp.mkdir(path.dirname(file), { recursive: true });
    const line = {
      v: 1, type: 'change', at: 10, agent: 'Main', tool: 'edit', op: 'update',
      path: '/repo/gone.ts', displayPath: 'gone.ts', before: '1-nope', after: '1-nope2', source: 'tool',
    };
    await fsp.writeFile(file, `${JSON.stringify(line)}\n`);
    const diff = await readSessionChangeDiff('sess-missing', '/repo/gone.ts', 0, 100);
    expect(diff?.unavailableReason).toBe('unreadable');
    expect(diff?.unavailableLimitBytes).toBeUndefined();
  });
});

describe('omp 19 patch journal', () => {
  test('the diff rebuilds both sides from the hunks', async () => {
    const diff = await readSessionChangeDiff(PATCH_SESSION, patchPath, 0, 100);
    expect(diff?.status).toBe('added');
    expect(diff?.oldContent).toBe('');
    expect(diff?.newContent).toBe('## 09:12\n\n- **Outcome**: success\n');
    expect(diff?.unavailable).toBe(false);
    expect(diff?.diff).toContain('+## 09:12');
  });

  test('the stats count the rebuilt pair instead of dropping the path', async () => {
    const stats = await readSessionChangeStats(PATCH_SESSION, 0, 100);
    expect(stats[patchPath]?.removed).toBe(0);
    expect(stats[patchPath]?.added).toBeGreaterThan(0);
  });

  test('the list keeps the record and states its existence', async () => {
    const records = await readSessionChangeList(PATCH_SESSION);
    expect(records.map((record) => [record.path, record.existedBefore, record.existsAfter])).toEqual([
      [patchPath, false, true],
    ]);
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
