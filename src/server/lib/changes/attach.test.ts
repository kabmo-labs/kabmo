/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The attach seam: a live session's raw frames reach the journal.
 *
 * The unit tests for the capture and the reader prove the two halves; this one
 * proves the wire between them — `onRawEvent` is the subscription, the real
 * filesystem is the source, and a `bash rm` lands as a `delete` record.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { attachChangeJournal } from '@/server/lib/changes/attach.server';
import { journalPath } from '@/server/lib/changes/paths.server';
import { parseJournalLine, type JournalRecord } from '@/server/lib/changes/records';
import type { AgentEvent } from '@/server/lib/omp/rpc/constants';

let dataDir = '';
let cwd = '';
let original: string | undefined;

beforeAll(async () => {
  original = Bun.env.KABMO_DATA_DIR;
  dataDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'kabmo-changes-attach-'));
  cwd = await fsp.mkdtemp(path.join(os.tmpdir(), 'kabmo-changes-cwd-'));
  Bun.env.KABMO_DATA_DIR = dataDir;
});

afterAll(async () => {
  if (original === undefined) delete Bun.env.KABMO_DATA_DIR;
  else Bun.env.KABMO_DATA_DIR = original;
  await fsp.rm(dataDir, { recursive: true, force: true });
  await fsp.rm(cwd, { recursive: true, force: true });
});

describe('attachChangeJournal', () => {
  test('subscribes to the raw stream and journals a bash delete', async () => {
    const file = path.join(cwd, 'a.txt');
    await fsp.writeFile(file, 'old');
    const listeners: ((event: AgentEvent) => void)[] = [];
    const session = {
      sessionId: 'attach-1',
      cwd,
      onEvent: () => () => {},
      onRawEvent: (listener: (event: AgentEvent) => void) => {
        listeners.push(listener);
        return () => {};
      },
    };

    const attachment = attachChangeJournal(session);
    expect(listeners.length).toBe(1);

    listeners[0]({
      type: 'tool_execution_start',
      toolCallId: 'c1',
      toolName: 'bash',
      args: { command: 'rm -f a.txt' },
    });
    await attachment.flush();
    await fsp.rm(file);
    listeners[0]({
      type: 'tool_execution_end',
      toolCallId: 'c1',
      toolName: 'bash',
      result: { details: { trace: { status: 0, units: [{ nodes: [{ k: 'simple', argv: ['rm', '-f', 'a.txt'], st: 0 }] }] } } },
    });
    await attachment.flush();
    attachment.detach();

    const text = await Bun.file(journalPath('attach-1')).text();
    const records = text.split('\n').map(parseJournalLine).filter((line): line is JournalRecord => line !== null);
    const change = records.find((line) => line.type === 'change');
    expect(change?.type).toBe('change');
    if (change?.type !== 'change') throw new Error('expected a change record');
    expect(change.op).toBe('delete');
    expect(change.path).toBe(file);
    expect(change.source).toBe('trace');
  });

  test('a session with no frame stream is a no-op, not a crash', () => {
    const attachment = attachChangeJournal({
      sessionId: 'attach-2',
      cwd,
      onEvent: undefined as never,
    });
    expect(() => attachment.detach()).not.toThrow();
  });
});
