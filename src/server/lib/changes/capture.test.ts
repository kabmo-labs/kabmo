/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The capture layer: a tool call's frames become journal records.
 *
 * The cases are the ones the feature exists for — an `edit`, a `write`, a
 * `bash rm`, a `sed -i`, a redirect — plus the two honest failures: an opaque
 * command is a `note`, and a subagent's write is attributed to the child.
 *
 * The fake filesystem is a `Map`, so the before/after pair is deterministic:
 * `flush()` after the start frame proves the snapshot ran before the test
 * changes the file.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { makeCapture, records } from '@/server/lib/changes/capture-test-util';
import { readSessionChangeDiff } from '@/server/lib/changes/reader.server';

let dataDir = '';
let original: string | undefined;

beforeAll(async () => {
  original = Bun.env.KABMO_DATA_DIR;
  dataDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'kabmo-changes-capture-'));
  Bun.env.KABMO_DATA_DIR = dataDir;
});

afterAll(async () => {
  if (original === undefined) delete Bun.env.KABMO_DATA_DIR;
  else Bun.env.KABMO_DATA_DIR = original;
  await fsp.rm(dataDir, { recursive: true, force: true });
});

const WINDOW_END = Date.now() + 60_000;

describe('tool adapters', () => {
  test('edit records the before and after text', async () => {
    const files = new Map([['/repo/a.ts', 'old']]);
    const capture = makeCapture('cap-edit', files);
    capture.onFrame({
      type: 'tool_execution_start',
      toolCallId: 'c1',
      toolName: 'edit',
      args: { path: 'a.ts', old_string: 'old', new_string: 'new' },
    });
    await capture.flush();
    files.set('/repo/a.ts', 'new');
    capture.onFrame({ type: 'tool_execution_end', toolCallId: 'c1', toolName: 'edit' });
    await capture.flush();

    const diff = await readSessionChangeDiff('cap-edit', '/repo/a.ts', 0, WINDOW_END);
    expect(diff?.status).toBe('modified');
    expect(diff?.oldContent).toBe('old');
    expect(diff?.newContent).toBe('new');
  });

  test('write of a new file is a create', async () => {
    const files = new Map<string, string>();
    const capture = makeCapture('cap-write', files);
    capture.onFrame({
      type: 'tool_execution_start',
      toolCallId: 'c1',
      toolName: 'write',
      args: { path: 'b.ts', content: 'B' },
    });
    await capture.flush();
    files.set('/repo/b.ts', 'B');
    capture.onFrame({ type: 'tool_execution_end', toolCallId: 'c1', toolName: 'write' });
    await capture.flush();

    const diff = await readSessionChangeDiff('cap-write', '/repo/b.ts', 0, WINDOW_END);
    expect(diff?.status).toBe('added');
    expect(diff?.newContent).toBe('B');
  });
});

describe('bash capture', () => {
  test('rm is a delete, from the trace argv', async () => {
    const files = new Map([['/repo/c.ts', 'C']]);
    const capture = makeCapture('cap-rm', files);
    capture.onFrame({
      type: 'tool_execution_start',
      toolCallId: 'c1',
      toolName: 'bash',
      args: { command: 'rm -f c.ts' },
    });
    await capture.flush();
    files.delete('/repo/c.ts');
    capture.onFrame({
      type: 'tool_execution_end',
      toolCallId: 'c1',
      toolName: 'bash',
      result: { details: { trace: { status: 0, units: [{ nodes: [{ k: 'simple', argv: ['rm', '-f', 'c.ts'], st: 0 }] }] } } },
    });
    await capture.flush();

    const diff = await readSessionChangeDiff('cap-rm', '/repo/c.ts', 0, WINDOW_END);
    expect(diff?.status).toBe('deleted');
    expect(diff?.oldContent).toBe('C');
  });

  test('sed -i is an update', async () => {
    const files = new Map([['/repo/d.ts', 'a']]);
    const capture = makeCapture('cap-sed', files);
    capture.onFrame({
      type: 'tool_execution_start',
      toolCallId: 'c1',
      toolName: 'bash',
      args: { command: "sed -i 's/a/b/' d.ts" },
    });
    await capture.flush();
    files.set('/repo/d.ts', 'b');
    capture.onFrame({
      type: 'tool_execution_end',
      toolCallId: 'c1',
      toolName: 'bash',
      result: { details: { trace: { status: 0, units: [{ nodes: [{ k: 'simple', argv: ['sed', '-i', 's/a/b/', 'd.ts'], st: 0 }] }] } } },
    });
    await capture.flush();

    const diff = await readSessionChangeDiff('cap-sed', '/repo/d.ts', 0, WINDOW_END);
    expect(diff?.status).toBe('modified');
    expect(diff?.oldContent).toBe('a');
    expect(diff?.newContent).toBe('b');
  });

  test('a redirect is a create the trace does not name', async () => {
    const files = new Map<string, string>();
    const capture = makeCapture('cap-redirect', files);
    capture.onFrame({
      type: 'tool_execution_start',
      toolCallId: 'c1',
      toolName: 'bash',
      args: { command: 'echo hi > e.txt' },
    });
    await capture.flush();
    files.set('/repo/e.txt', 'hi\n');
    capture.onFrame({
      type: 'tool_execution_end',
      toolCallId: 'c1',
      toolName: 'bash',
      result: { details: { trace: { status: 0, units: [{ nodes: [{ k: 'simple', argv: ['echo', 'hi'], st: 0 }] }] } } },
    });
    await capture.flush();

    const diff = await readSessionChangeDiff('cap-redirect', '/repo/e.txt', 0, WINDOW_END);
    expect(diff?.status).toBe('added');
    expect(diff?.newContent).toBe('hi\n');
  });

  test('an opaque command is a note, not a guess', async () => {
    const files = new Map<string, string>();
    const capture = makeCapture('cap-opaque', files);
    capture.onFrame({
      type: 'tool_execution_start',
      toolCallId: 'c1',
      toolName: 'bash',
      args: { command: 'bun test' },
    });
    await capture.flush();
    capture.onFrame({
      type: 'tool_execution_end',
      toolCallId: 'c1',
      toolName: 'bash',
      result: { details: { trace: { status: 0, units: [{ nodes: [{ k: 'simple', argv: ['bun', 'test'], st: 0 }] }] } } },
    });
    await capture.flush();

    const lines = await records('cap-opaque');
    expect(lines.some((line) => line.type === 'change')).toBe(false);
    const note = lines.find((line) => line.type === 'note');
    expect(note?.type).toBe('note');
    if (note?.type !== 'note') throw new Error('expected a note');
    expect(note.reason).toBe('opaque-command');
  });
});

describe('scan pass', () => {
  test('an opaque git reset is reconciled from the two snapshots', async () => {
    const files = new Map([['/repo/g.ts', 'old']]);
    const scans = [
      { root: '/repo', dirty: new Map([['/repo/g.ts', 'old']]), truncated: false },
      { root: '/repo', dirty: new Map([['/repo/g.ts', 'new']]), truncated: false },
    ];
    const capture = makeCapture('cap-scan', files, {
      takeScan: async () => scans.shift() ?? null,
      readHead: async () => null,
    });
    capture.onFrame({
      type: 'tool_execution_start',
      toolCallId: 'c1',
      toolName: 'bash',
      args: { command: 'git reset --hard' },
    });
    await capture.flush();
    files.set('/repo/g.ts', 'new');
    capture.onFrame({
      type: 'tool_execution_end',
      toolCallId: 'c1',
      toolName: 'bash',
      result: { details: { trace: { status: 0, units: [{ nodes: [{ k: 'simple', argv: ['git', 'reset', '--hard'], st: 0 }] }] } } },
    });
    await capture.flush();

    const diff = await readSessionChangeDiff('cap-scan', '/repo/g.ts', 0, WINDOW_END);
    expect(diff?.status).toBe('modified');
    expect(diff?.oldContent).toBe('old');
    expect(diff?.newContent).toBe('new');
  });
});

describe('subagents', () => {
  test('a child edit is attributed to the child', async () => {
    const files = new Map([['/repo/f.ts', 'old']]);
    const capture = makeCapture('cap-sub', files);
    capture.onFrame({
      type: 'subagent_event',
      payload: { type: 'tool_execution_start', toolCallId: 's1', toolName: 'edit', args: { path: 'f.ts' }, agent: 'Child' },
    });
    await capture.flush();
    files.set('/repo/f.ts', 'new');
    capture.onFrame({
      type: 'subagent_event',
      payload: { type: 'tool_execution_end', toolCallId: 's1', toolName: 'edit', agent: 'Child' },
    });
    await capture.flush();

    const change = (await records('cap-sub')).find((line) => line.type === 'change');
    expect(change?.type).toBe('change');
    if (change?.type !== 'change') throw new Error('expected a change');
    expect(change.agent).toBe('Child');
  });
});
