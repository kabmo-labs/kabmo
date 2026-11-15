/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Reading the agent change journal behind the chat's per-run file list.
 *
 * The journal is a document omp writes, not one Kabmo wrote, so the tests pin
 * the two things a wrong read would break: the display path (a file outside the
 * session cwd must not be shown as `../…`) and the net change of a run (the
 * first record's `before` to the last record's `after`, not one write's pair).
 * The session dir is redirected through `PI_CODING_AGENT_DIR`, the same seam
 * the artifact tests use.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { readSessionChangeDiff, readSessionChangeIndex, readSessionChangeStats } from '@/server/lib/omp/session/changes';
import { clearSessionFileCaches } from '@/server/lib/omp/session/files';

const SESSION_ID = '01a0cc50-fd62-7417-899c-e24ff8c8608c';
const CWD = '/tmp/project';
let agentDir = '';
let sessionFile = '';
let journalDir = '';

/** Write a gzip blob under the journal's `blobs/` and return its key. */
async function blob(key: string, text: string): Promise<string> {
  await fsp.mkdir(path.join(journalDir, 'blobs'), { recursive: true });
  await fsp.writeFile(path.join(journalDir, 'blobs', key), Bun.gzipSync(Buffer.from(text, 'utf8')));
  return key;
}

async function append(record: Record<string, unknown>): Promise<void> {
  await fsp.appendFile(path.join(journalDir, 'changes.jsonl'), `${JSON.stringify(record)}\n`);
}

beforeAll(async () => {
  agentDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'omp-changes-test-'));
  process.env.PI_CODING_AGENT_DIR = agentDir;
  const cwdDir = path.join(agentDir, 'sessions', '-tmp-project');
  await fsp.mkdir(cwdDir, { recursive: true });
  sessionFile = path.join(cwdDir, `2026-01-01T00-00-00-000Z_${SESSION_ID}.jsonl`);
  await fsp.writeFile(
    sessionFile,
    `${JSON.stringify({ type: 'session', version: 3, id: SESSION_ID, timestamp: '2026-01-01T00:00:00.000Z', cwd: CWD })}\n`,
  );
  journalDir = sessionFile.slice(0, -'.jsonl'.length);
  await fsp.mkdir(journalDir, { recursive: true });
  clearSessionFileCaches();
});

afterAll(async () => {
  delete process.env.PI_CODING_AGENT_DIR;
  clearSessionFileCaches();
  await fsp.rm(agentDir, { recursive: true, force: true });
});

describe('readSessionChangeIndex', () => {
  test('a session with no journal answers an empty list', async () => {
    expect(await readSessionChangeIndex(SESSION_ID)).toEqual([]);
  });

  test('resolves a display path inside the cwd and keeps an outside path absolute', async () => {
    const inside = await blob('a1', 'one\n');
    const outside = await blob('a2', 'two\n');
    await append({ type: 'change', at: 1000, agent: 'Main', tool: 'edit', path: `${CWD}/src/a.ts`, before: null, after: inside });
    await append({ type: 'change', at: 1001, agent: 'Main', tool: 'edit', path: '/elsewhere/b.ts', before: null, after: outside });
    // A `call` record is not a file change and must not reach the list.
    await append({ type: 'call', agent: 'Main', tool: 'bash', start: 1002, end: 1003, label: 'bun test' });

    const records = await readSessionChangeIndex(SESSION_ID);
    expect(records.map((record) => record.displayPath)).toEqual(['src/a.ts', '/elsewhere/b.ts']);
    expect(records[0]?.before).toBeNull();
    expect(records[0]?.after).toBe(inside);
  });

  test('a torn final line is skipped, not fatal', async () => {
    await fsp.appendFile(path.join(journalDir, 'changes.jsonl'), '{"type":"change","at":\n');
    const records = await readSessionChangeIndex(SESSION_ID);
    expect(records.length).toBe(2);
  });

  test('a Windows-style separator in the journal path is shown with forward slashes', async () => {
    const after = await blob('a3', 'three\n');
    await append({ type: 'change', at: 1004, agent: 'Main', tool: 'edit', path: `${CWD}/src\\win.ts`, before: null, after });

    const records = await readSessionChangeIndex(SESSION_ID);
    expect(records.at(-1)?.displayPath).toBe('src/win.ts');
  });
});

describe('readSessionChangeDiff', () => {
  test('returns the net change of a run: first before to last after', async () => {
    const before = await blob('b1', 'line one\nline two\n');
    const middle = await blob('b2', 'line one\nline TWO\n');
    const after = await blob('b3', 'line one\nline TWO\nline three\n');
    const file = `${CWD}/src/net.ts`;
    await append({ type: 'change', at: 2000, agent: 'Main', tool: 'edit', path: file, before, after: middle });
    await append({ type: 'change', at: 2001, agent: 'Main', tool: 'edit', path: file, before: middle, after });

    const diff = await readSessionChangeDiff(SESSION_ID, file, 2000, 2001);
    expect(diff?.status).toBe('modified');
    expect(diff?.oldContent).toBe('line one\nline two\n');
    expect(diff?.newContent).toBe('line one\nline TWO\nline three\n');
    expect(diff?.diff).toContain('+line three');
    expect(diff?.unavailable).toBe(false);
  });

  test('a created file is added, a deleted file is deleted', async () => {
    const created = await blob('c1', 'new\n');
    const addedPath = `${CWD}/src/added.ts`;
    await append({ type: 'change', at: 3000, agent: 'Main', tool: 'write', path: addedPath, before: null, after: created });
    const added = await readSessionChangeDiff(SESSION_ID, addedPath, 3000, 3000);
    expect(added?.status).toBe('added');
    expect(added?.oldContent).toBe('');

    const deletedPath = `${CWD}/src/deleted.ts`;
    await append({ type: 'change', at: 3001, agent: 'Main', tool: 'write', path: deletedPath, before: created, after: null });
    const deleted = await readSessionChangeDiff(SESSION_ID, deletedPath, 3001, 3001);
    expect(deleted?.status).toBe('deleted');
    expect(deleted?.newContent).toBe('');
  });

  test('a blob that was not stored reports unavailable instead of an empty diff', async () => {
    const file = `${CWD}/src/huge.ts`;
    await append({ type: 'change', at: 4000, agent: 'Main', tool: 'write', path: file, before: undefined, after: undefined });
    const diff = await readSessionChangeDiff(SESSION_ID, file, 4000, 4000);
    expect(diff?.unavailable).toBe(true);
  });

  test('a path with no record in the range answers null', async () => {
    expect(await readSessionChangeDiff(SESSION_ID, `${CWD}/src/net.ts`, 9000, 9001)).toBeNull();
  });
});

describe('readSessionChangeStats', () => {
  test('counts the net change of the run, not each write', async () => {
    const before = await blob('s1', 'alpha\nbeta\n');
    const middle = await blob('s2', 'alpha\nBETA\n');
    const after = await blob('s3', 'alpha\nBETA\ngamma\n');
    const file = `${CWD}/src/stats.ts`;
    await append({ type: 'change', at: 5000, agent: 'Main', tool: 'edit', path: file, before, after: middle });
    await append({ type: 'change', at: 5001, agent: 'Main', tool: 'edit', path: file, before: middle, after });

    expect(await readSessionChangeStats(SESSION_ID, 5000, 5001)).toEqual({
      [file]: { added: 2, removed: 1 },
    });
  });

  test('a created file counts its lines as additions', async () => {
    const created = await blob('s4', 'one\ntwo\n');
    const file = `${CWD}/src/created-stats.ts`;
    await append({ type: 'change', at: 5100, agent: 'Main', tool: 'write', path: file, before: null, after: created });

    expect(await readSessionChangeStats(SESSION_ID, 5100, 5100)).toEqual({
      [file]: { added: 2, removed: 0 },
    });
  });

  test('a path whose blob was not stored is absent, not zero', async () => {
    const file = `${CWD}/src/unstored.ts`;
    await append({ type: 'change', at: 5200, agent: 'Main', tool: 'write', path: file, before: undefined, after: undefined });

    expect(await readSessionChangeStats(SESSION_ID, 5200, 5200)).toEqual({});
  });
});
