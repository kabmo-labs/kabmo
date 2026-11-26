/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Rebuilding omp 19's patch journal.
 *
 * The writer stores hunks, not blob keys, and the tests pin the parts a wrong
 * rebuild would silently corrupt: the line split (a trailing newline is a
 * trailing empty line), the chain from a record with no `base`, a hunk list
 * that lives in a blob, and the checksum gate that refuses a diff which does
 * not reproduce the recorded `sum`.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { patchExistence, readPatchSides } from '@/server/lib/omp/session/changes-patch';
import { clearSessionFileCaches } from '@kabmo-labs/kabmo-omp-session-scan/files';

const SESSION_ID = '01a20b52-7000-7000-8000-000000000001';
let agentDir = '';
let journalDir = '';

const sum = (text: string): string => Bun.hash(text).toString(36);

async function blob(text: string): Promise<string> {
  const key = `${Buffer.byteLength(text).toString(36)}-${sum(text)}`;
  await fsp.mkdir(path.join(journalDir, 'blobs'), { recursive: true });
  await fsp.writeFile(path.join(journalDir, 'blobs', key), Bun.gzipSync(Buffer.from(text, 'utf8')));
  return key;
}

beforeAll(async () => {
  agentDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'omp-changes-patch-'));
  process.env.PI_CODING_AGENT_DIR = agentDir;
  const cwdDir = path.join(agentDir, 'sessions', '-tmp-project');
  await fsp.mkdir(cwdDir, { recursive: true });
  const sessionFile = path.join(cwdDir, `2026-01-01T00-00-00-000Z_${SESSION_ID}.jsonl`);
  await fsp.writeFile(sessionFile, `${JSON.stringify({ type: 'session', version: 3, id: SESSION_ID, cwd: '/tmp/project' })}\n`);
  journalDir = sessionFile.slice(0, -'.jsonl'.length);
  await fsp.mkdir(journalDir, { recursive: true });
  clearSessionFileCaches();
});

afterAll(async () => {
  delete process.env.PI_CODING_AGENT_DIR;
  clearSessionFileCaches();
  await fsp.rm(agentDir, { recursive: true, force: true });
});

describe('readPatchSides', () => {
  test('a create rebuilds from a null base', async () => {
    const sides = await readPatchSides(SESSION_ID, [
      { base: null, edit: [[0, 0, ['one', 'two', '']]], sum: sum('one\ntwo\n') },
    ]);
    expect(sides[0]).toEqual({ before: null, after: 'one\ntwo\n' });
  });

  test('a record with no base continues the previous after, through a gap', async () => {
    const sides = await readPatchSides(SESSION_ID, [
      { base: null, edit: [[0, 0, ['a', 'b', '']]], sum: sum('a\nb\n') },
      // Someone else moved the file on between the two writes: `gap` is the
      // step from the cached after to this record's real before.
      { gap: [[1, 1, ['B']]], edit: [[0, 2, ['A', 'B']]], sum: sum('A\nB\n') },
    ]);
    expect(sides[1]).toEqual({ before: 'a\nB\n', after: 'A\nB\n' });
  });

  test('a hunk list stored as a blob is read back', async () => {
    const hunks = JSON.stringify([[0, 0, ['blob', '']]]);
    const key = await blob(hunks);
    const sides = await readPatchSides(SESSION_ID, [{ base: null, edit: key, sum: sum('blob\n') }]);
    expect(sides[0]?.after).toBe('blob\n');
  });

  test('a base stored as a blob key resolves the before side', async () => {
    const key = await blob('old\n');
    const sides = await readPatchSides(SESSION_ID, [{ base: key, edit: [[0, 1, ['new']]], sum: sum('new\n') }]);
    expect(sides[0]).toEqual({ before: 'old\n', after: 'new\n' });
  });

  test('a checksum that does not match is unknown, never a diff', async () => {
    const sides = await readPatchSides(SESSION_ID, [
      { base: null, edit: [[0, 0, ['wrong', '']]], sum: sum('right\n') },
    ]);
    expect(sides[0]).toBeUndefined();
  });

  test('a delete leaves the after side absent', async () => {
    const sides = await readPatchSides(SESSION_ID, [
      { base: await blob('gone\n'), edit: [[0, 2, []]], sum: '-' },
    ]);
    expect(sides[0]).toEqual({ before: 'gone\n', after: null });
  });

  test('a record with no patch is unknown and ends the chain', async () => {
    const sides = await readPatchSides(SESSION_ID, [
      undefined,
      { edit: [[0, 0, ['x', '']]], sum: sum('x\n') },
    ]);
    expect(sides).toEqual([undefined, undefined]);
  });
});

describe('patchExistence', () => {
  test('a break in the chain leaves existence unknown, not guessed', () => {
    expect(patchExistence([
      { base: null, sum: sum('a\n') },
      undefined,
      { edit: [], sum: sum('b\n') },
    ])).toEqual([
      { existedBefore: false, existsAfter: true },
      {},
      { existsAfter: true },
    ]);
  });
});
