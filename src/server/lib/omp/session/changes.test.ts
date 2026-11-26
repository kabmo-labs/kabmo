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
import { readSessionChangeIndex, readSessionChangeList } from '@/server/lib/omp/session/changes';
import { clearSessionFileCaches } from '@kabmo-labs/kabmo-omp-session-scan/files';

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

describe('patch records (omp 19)', () => {
  test('a created file states its sides without a blob key', async () => {
    const text = 'one\ntwo\n';
    const file = `${CWD}/src/patch-create.ts`;
    await append({
      type: 'change', at: 7000, agent: 'Main', tool: 'bash', path: file,
      base: null, edit: [[0, 0, ['one', 'two', '']]], sum: Bun.hash(text).toString(36),
    });

    const [record] = (await readSessionChangeIndex(SESSION_ID)).filter((entry) => entry.path === file);
    expect(record?.before).toBeNull();
    expect(record?.existedBefore).toBe(false);
    expect(record?.existsAfter).toBe(true);
    expect(record?.patch?.base).toBeNull();
  });

  test('a chained write inherits existence, and a delete states its own', async () => {
    const file = `${CWD}/src/patch-chain.ts`;
    const recordsFor = [
      { at: 7100, base: null, edit: [[0, 0, ['one', 'two', '']]], sum: Bun.hash('one\ntwo\n').toString(36) },
      { at: 7101, edit: [[1, 1, ['TWO']]], sum: Bun.hash('one\nTWO\n').toString(36) },
      { at: 7102, edit: [[0, 2, []]], sum: '-' },
    ];
    for (const record of recordsFor) {
      await append({ type: 'change', agent: 'Main', tool: 'bash', path: file, ...record });
    }

    const records = (await readSessionChangeIndex(SESSION_ID)).filter((entry) => entry.path === file);
    expect(records.map((record) => [record.existedBefore, record.existsAfter])).toEqual([
      [false, true],
      [true, true],
      [true, false],
    ]);
  });

  test('a record omp could not store has no patch and keeps the before unknown', async () => {
    const file = `${CWD}/src/patch-unstored.ts`;
    await append({ type: 'change', at: 7200, agent: 'Main', tool: 'bash', path: file });

    const [record] = (await readSessionChangeIndex(SESSION_ID)).filter((entry) => entry.path === file);
    expect(record?.patch).toBeUndefined();
    expect(record?.before).toBeUndefined();
    expect(record?.existedBefore).toBeUndefined();
  });
});

describe('readSessionChangeList', () => {
  test('drops a creation whose file is gone — a bash rm never reaches the journal', async () => {
    const created = await blob('l1', 'gone\n');
    const file = path.join(agentDir, 'gone.ts');
    await append({ type: 'change', at: 6000, agent: 'Main', tool: 'write', path: file, before: null, after: created });

    expect(await readSessionChangeIndex(SESSION_ID)).toContainEqual(
      expect.objectContaining({ path: file }),
    );
    expect((await readSessionChangeList(SESSION_ID)).some((record) => record.path === file)).toBe(false);
  });

  test('keeps a creation whose file still exists', async () => {
    const created = await blob('l2', 'here\n');
    const file = path.join(agentDir, 'here.ts');
    await fsp.writeFile(file, 'here\n');
    await append({ type: 'change', at: 6001, agent: 'Main', tool: 'write', path: file, before: null, after: created });

    expect((await readSessionChangeList(SESSION_ID)).some((record) => record.path === file)).toBe(true);
  });

  test('keeps a modified path even when the file is gone', async () => {
    const before = await blob('l3', 'a\n');
    const after = await blob('l4', 'b\n');
    const file = path.join(agentDir, 'modified-gone.ts');
    await append({ type: 'change', at: 6002, agent: 'Main', tool: 'edit', path: file, before, after });

    expect((await readSessionChangeList(SESSION_ID)).some((record) => record.path === file)).toBe(true);
  });
});

describe('readSessionChangeList with patch records', () => {
  test('drops a created-then-deleted patch path, from the patch metadata', async () => {
    const file = `${CWD}/src/patch-gone.ts`;
    await append({
      type: 'change', at: 8000, agent: 'Main', tool: 'bash', path: file,
      base: null, edit: [[0, 0, ['gone', '']]], sum: Bun.hash('gone\n').toString(36),
    });
    await append({ type: 'change', at: 8001, agent: 'Main', tool: 'bash', path: file, edit: [[0, 1, []]], sum: '-' });

    expect((await readSessionChangeList(SESSION_ID)).some((record) => record.path === file)).toBe(false);
  });

  test('keeps a patch record whose file still exists', async () => {
    const file = path.join(agentDir, 'patch-here.ts');
    await fsp.writeFile(file, 'here\n');
    await append({
      type: 'change', at: 8002, agent: 'Main', tool: 'bash', path: file,
      base: null, edit: [[0, 0, ['here', '']]], sum: Bun.hash('here\n').toString(36),
    });

    expect((await readSessionChangeList(SESSION_ID)).some((record) => record.path === file)).toBe(true);
  });
});
