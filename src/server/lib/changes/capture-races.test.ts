/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Snapshot races: the start-frame read lost to the tool's own write.
 *
 * A `write` whose before snapshot already holds the after content, and a fast
 * `bash` command that finishes before the snapshot reads the file, must not be
 * dropped. The birth time decides create (A) from rewrite (M), and a rewrite
 * with no omp record is an unknown before plus a `snapshot-race` note.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { makeCapture, records, REPO } from '@/server/lib/changes/capture-test-util';

// The capture journals the host's spelling of the path: a literal `/repo` never
// matches on Windows.
const RACE = path.join(REPO, 'race.txt');

let dataDir = '';
let agentDir = '';
let original: string | undefined;
let originalAgent: string | undefined;

beforeAll(async () => {
  original = Bun.env.KABMO_DATA_DIR;
  originalAgent = Bun.env.PI_CODING_AGENT_DIR;
  dataDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'kabmo-changes-races-'));
  agentDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'kabmo-changes-races-agent-'));
  Bun.env.KABMO_DATA_DIR = dataDir;
  Bun.env.PI_CODING_AGENT_DIR = agentDir;
});

afterAll(async () => {
  if (original === undefined) delete Bun.env.KABMO_DATA_DIR;
  else Bun.env.KABMO_DATA_DIR = original;
  if (originalAgent === undefined) delete Bun.env.PI_CODING_AGENT_DIR;
  else Bun.env.PI_CODING_AGENT_DIR = originalAgent;
  await fsp.rm(dataDir, { recursive: true, force: true });
  await fsp.rm(agentDir, { recursive: true, force: true });
});

describe('snapshot races', () => {
  test('a write whose snapshot raced is recorded with an unknown before', async () => {
    const files = new Map([[RACE, 'content']]);
    const capture = makeCapture('cap-write-race', files);
    capture.onFrame({
      type: 'tool_execution_start',
      toolCallId: 'c1',
      toolName: 'write',
      args: { path: 'race.txt', content: 'content' },
    });
    await capture.flush();
    // The file already holds the content: the snapshot read the after state.
    capture.onFrame({ type: 'tool_execution_end', toolCallId: 'c1', toolName: 'write' });
    await capture.flush();

    const lines = await records('cap-write-race');
    const change = lines.find((line) => line.type === 'change');
    expect(change?.type).toBe('change');
    if (change?.type !== 'change') throw new Error('expected a change');
    expect(change.before).toBeUndefined();
    expect(typeof change.after).toBe('string');
    const note = lines.find((line) => line.type === 'note');
    expect(note?.type).toBe('note');
    if (note?.type !== 'note') throw new Error('expected a note');
    expect(note.reason).toBe('snapshot-race');
  });

  test('a fast bash create whose snapshot raced is recorded as a create', async () => {
    const files = new Map([[RACE, 'hi\n']]);
    const capture = makeCapture('cap-bash-race', files, {
      statFile: async (absolute) =>
        files.has(absolute)
          ? { mtimeMs: Date.now() + 1000, size: files.get(absolute)?.length ?? 0, birthtimeMs: Date.now() + 1000 }
          : null,
    });
    capture.onFrame({
      type: 'tool_execution_start',
      toolCallId: 'c1',
      toolName: 'bash',
      args: { command: 'echo hi > race.txt' },
    });
    await capture.flush();
    capture.onFrame({
      type: 'tool_execution_end',
      toolCallId: 'c1',
      toolName: 'bash',
      result: { details: { trace: { status: 0, units: [{ nodes: [{ k: 'simple', argv: ['echo', 'hi'], st: 0 }] }] } } },
    });
    await capture.flush();

    const lines = await records('cap-bash-race');
    const change = lines.find((line) => line.type === 'change');
    expect(change?.type).toBe('change');
    if (change?.type !== 'change') throw new Error('expected a change');
    expect(change.before).toBeNull();
    expect(typeof change.after).toBe('string');
    expect(lines.some((line) => line.type === 'note')).toBe(false);
  });
});

