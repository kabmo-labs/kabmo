/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The journal writer: one append-only JSONL, content-addressed blobs, and the
 * two rules a reader depends on — a header on the first line and a torn line
 * that never poisons the rest.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { ChangeJournal } from '@/server/lib/changes/journal.server';
import { blobsDir, journalPath } from '@/server/lib/changes/paths.server';
import { parseJournalLine, type JournalRecord } from '@/server/lib/changes/records';

let dataDir = '';
let original: string | undefined;

beforeAll(async () => {
  original = Bun.env.KABMO_DATA_DIR;
  dataDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'kabmo-changes-'));
  Bun.env.KABMO_DATA_DIR = dataDir;
});

afterAll(async () => {
  if (original === undefined) delete Bun.env.KABMO_DATA_DIR;
  else Bun.env.KABMO_DATA_DIR = original;
  await fsp.rm(dataDir, { recursive: true, force: true });
});

async function readLines(sessionId: string): Promise<JournalRecord[]> {
  const text = await Bun.file(journalPath(sessionId)).text();
  return text.split('\n').map(parseJournalLine).filter((line): line is JournalRecord => line !== null);
}

describe('ChangeJournal', () => {
  test('writes a session header, then the change with blob keys', async () => {
    const journal = new ChangeJournal('sess-write', '/repo');
    await journal.recordChange({
      at: 100,
      agent: 'Main',
      tool: 'edit',
      op: 'update',
      path: '/repo/a.ts',
      displayPath: 'a.ts',
      before: 'old',
      after: 'new',
      source: 'tool',
    });
    await journal.flush();

    const lines = await readLines('sess-write');
    expect(lines[0]?.type).toBe('session');
    const change = lines[1];
    expect(change?.type).toBe('change');
    if (change?.type !== 'change') throw new Error('expected a change record');
    expect(change.before).toMatch(/^3-/);
    expect(change.after).toMatch(/^3-/);
    expect(change.before).not.toBe(change.after);

    const blobs = await fsp.readdir(blobsDir('sess-write'));
    expect(blobs.length).toBe(2);
  });

  test('reuses a blob for the same content', async () => {
    const journal = new ChangeJournal('sess-dedupe', '/repo');
    await journal.recordChange({
      at: 1, agent: 'Main', tool: 'edit', op: 'update', path: '/repo/a.ts',
      displayPath: 'a.ts', before: 'same', after: 'one', source: 'tool',
    });
    await journal.recordChange({
      at: 2, agent: 'Main', tool: 'edit', op: 'update', path: '/repo/b.ts',
      displayPath: 'b.ts', before: 'same', after: 'two', source: 'tool',
    });
    await journal.flush();

    const blobs = await fsp.readdir(blobsDir('sess-dedupe'));
    // 'same' once, 'one' once, 'two' once.
    expect(blobs.length).toBe(3);
  });

  test('truncates a large call argument bag and says so', async () => {
    const journal = new ChangeJournal('sess-call', '/repo');
    await journal.recordCall({
      at: 1,
      toolCallId: 'c1',
      agent: 'Main',
      tool: 'bash',
      args: { command: 'x'.repeat(5000) },
    });
    await journal.flush();

    const call = (await readLines('sess-call')).find((line) => line.type === 'call');
    expect(call?.type).toBe('call');
    if (call?.type !== 'call') throw new Error('expected a call record');
    expect(call.argsTruncated).toBe(true);
    expect(typeof call.args).toBe('string');
  });

  test('records a note without inventing a change', async () => {
    const journal = new ChangeJournal('sess-note', '/repo');
    await journal.recordNote({ at: 1, toolCallId: 'c1', reason: 'opaque-command', detail: 'bun test' });
    await journal.flush();

    const lines = await readLines('sess-note');
    expect(lines.map((line) => line.type)).toEqual(['session', 'note']);
  });

  test('a torn final line is skipped by the parser', async () => {
    const journal = new ChangeJournal('sess-torn', '/repo');
    await journal.recordChange({
      at: 1, agent: 'Main', tool: 'edit', op: 'create', path: '/repo/a.ts',
      displayPath: 'a.ts', before: null, after: 'A', source: 'tool',
    });
    await journal.flush();
    await fsp.appendFile(journalPath('sess-torn'), '{"v":1,"type":"change"');

    const lines = await readLines('sess-torn');
    expect(lines.map((line) => line.type)).toEqual(['session', 'change']);
  });
});
