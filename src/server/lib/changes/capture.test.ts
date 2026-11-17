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
 * changes the file. Every path goes through `at()`, so the fixture is native
 * on Windows too.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { makeCapture, records, REPO } from '@/server/lib/changes/capture-test-util';
import { ChangeJournal } from '@/server/lib/changes/journal.server';
import { readSessionChangeDiff } from '@/server/lib/changes/reader.server';

let dataDir = '';
let agentDir = '';
let original: string | undefined;
let originalAgent: string | undefined;

beforeAll(async () => {
  original = Bun.env.KABMO_DATA_DIR;
  originalAgent = Bun.env.PI_CODING_AGENT_DIR;
  dataDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'kabmo-changes-capture-'));
  agentDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'kabmo-changes-capture-agent-'));
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

const WINDOW_END = Date.now() + 60_000;

/** A path inside the fixture repo, spelled the way the host spells it. */
function at(relative: string): string {
  return path.join(REPO, relative);
}

describe('tool adapters', () => {
  test('edit records the before and after text', async () => {
    const files = new Map([[at('a.ts'), 'old']]);
    const capture = makeCapture('cap-edit', files);
    capture.onFrame({
      type: 'tool_execution_start',
      toolCallId: 'c1',
      toolName: 'edit',
      args: { path: 'a.ts', old_string: 'old', new_string: 'new' },
    });
    await capture.flush();
    files.set(at('a.ts'), 'new');
    capture.onFrame({ type: 'tool_execution_end', toolCallId: 'c1', toolName: 'edit' });
    await capture.flush();

    const diff = await readSessionChangeDiff('cap-edit', at('a.ts'), 0, WINDOW_END);
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
    files.set(at('b.ts'), 'B');
    capture.onFrame({ type: 'tool_execution_end', toolCallId: 'c1', toolName: 'write' });
    await capture.flush();

    const diff = await readSessionChangeDiff('cap-write', at('b.ts'), 0, WINDOW_END);
    expect(diff?.status).toBe('added');
    expect(diff?.newContent).toBe('B');
  });
});

describe('temp paths', () => {
  test('a write under the OS temp dir is not journaled', async () => {
    const temp = path.join(os.tmpdir(), 'kabmo-temp-exclude.txt');
    const files = new Map([[temp, 'x']]);
    const capture = makeCapture('cap-temp', files);
    capture.onFrame({
      type: 'tool_execution_start',
      toolCallId: 'c1',
      toolName: 'write',
      args: { path: temp, content: 'x' },
    });
    await capture.flush();
    capture.onFrame({ type: 'tool_execution_end', toolCallId: 'c1', toolName: 'write' });
    await capture.flush();

    const lines = await records('cap-temp');
    expect(lines.some((line) => line.type === 'change')).toBe(false);
  });
});

describe('build paths', () => {
  test('a write under a build directory is not journaled', async () => {
    const file = path.join(REPO, 'dist', 'x.js');
    const files = new Map([[file, 'x']]);
    const capture = makeCapture('cap-build', files);
    capture.onFrame({
      type: 'tool_execution_start',
      toolCallId: 'c1',
      toolName: 'write',
      args: { path: file, content: 'x' },
    });
    await capture.flush();
    capture.onFrame({ type: 'tool_execution_end', toolCallId: 'c1', toolName: 'write' });
    await capture.flush();

    const lines = await records('cap-build');
    expect(lines.some((line) => line.type === 'change')).toBe(false);
  });
});

describe('bash capture', () => {
  test('rm is a delete, from the trace argv', async () => {
    const files = new Map([[at('c.ts'), 'C']]);
    const capture = makeCapture('cap-rm', files);
    capture.onFrame({
      type: 'tool_execution_start',
      toolCallId: 'c1',
      toolName: 'bash',
      args: { command: 'rm -f c.ts' },
    });
    await capture.flush();
    files.delete(at('c.ts'));
    capture.onFrame({
      type: 'tool_execution_end',
      toolCallId: 'c1',
      toolName: 'bash',
      result: { details: { trace: { status: 0, units: [{ nodes: [{ k: 'simple', argv: ['rm', '-f', 'c.ts'], st: 0 }] }] } } },
    });
    await capture.flush();

    const diff = await readSessionChangeDiff('cap-rm', at('c.ts'), 0, WINDOW_END);
    expect(diff?.status).toBe('deleted');
    expect(diff?.oldContent).toBe('C');
  });

  test('sed -i is an update', async () => {
    const files = new Map([[at('d.ts'), 'a']]);
    const capture = makeCapture('cap-sed', files);
    capture.onFrame({
      type: 'tool_execution_start',
      toolCallId: 'c1',
      toolName: 'bash',
      args: { command: "sed -i 's/a/b/' d.ts" },
    });
    await capture.flush();
    files.set(at('d.ts'), 'b');
    capture.onFrame({
      type: 'tool_execution_end',
      toolCallId: 'c1',
      toolName: 'bash',
      result: { details: { trace: { status: 0, units: [{ nodes: [{ k: 'simple', argv: ['sed', '-i', 's/a/b/', 'd.ts'], st: 0 }] }] } } },
    });
    await capture.flush();

    const diff = await readSessionChangeDiff('cap-sed', at('d.ts'), 0, WINDOW_END);
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
    files.set(at('e.txt'), 'hi\n');
    capture.onFrame({
      type: 'tool_execution_end',
      toolCallId: 'c1',
      toolName: 'bash',
      result: { details: { trace: { status: 0, units: [{ nodes: [{ k: 'simple', argv: ['echo', 'hi'], st: 0 }] }] } } },
    });
    await capture.flush();

    const diff = await readSessionChangeDiff('cap-redirect', at('e.txt'), 0, WINDOW_END);
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
    const files = new Map([[at('g.ts'), 'old']]);
    const scans = [
      { root: REPO, dirty: new Map([[at('g.ts'), 'old']]), truncated: false },
      { root: REPO, dirty: new Map([[at('g.ts'), 'new']]), truncated: false },
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
    files.set(at('g.ts'), 'new');
    capture.onFrame({
      type: 'tool_execution_end',
      toolCallId: 'c1',
      toolName: 'bash',
      result: { details: { trace: { status: 0, units: [{ nodes: [{ k: 'simple', argv: ['git', 'reset', '--hard'], st: 0 }] }] } } },
    });
    await capture.flush();

    const diff = await readSessionChangeDiff('cap-scan', at('g.ts'), 0, WINDOW_END);
    expect(diff?.status).toBe('modified');
    expect(diff?.oldContent).toBe('old');
    expect(diff?.newContent).toBe('new');
  });
});

describe('cross-session scan', () => {
  test('a scan skips a path another session in the same cwd recorded', async () => {
    const other = new ChangeJournal('cap-other', REPO);
    await other.recordChange({
      at: Date.now(), agent: 'Main', tool: 'edit', op: 'update', path: at('file4.txt'),
      displayPath: 'file4.txt', before: 'a', after: 'b', source: 'tool',
    });
    await other.flush();

    const files = new Map<string, string>();
    const scans = [
      { root: REPO, dirty: new Map<string, string | null>(), truncated: false },
      { root: REPO, dirty: new Map([[at('file4.txt'), 'python']]), truncated: false },
    ];
    const capture = makeCapture('cap-cross', files, {
      takeScan: async () => scans.shift() ?? null,
      readHead: async () => null,
    });
    capture.onFrame({
      type: 'tool_execution_start',
      toolCallId: 'c1',
      toolName: 'bash',
      args: { command: "python3 - <<'PY'\nopen('file4.txt','w').write('python')\nPY" },
    });
    await capture.flush();
    files.set(at('file4.txt'), 'python');
    capture.onFrame({
      type: 'tool_execution_end',
      toolCallId: 'c1',
      toolName: 'bash',
      result: { details: { trace: { status: 0, units: [{ nodes: [{ k: 'simple', argv: ['python3', '-'], st: 0 }] }] } } },
    });
    await capture.flush();

    const lines = await records('cap-cross');
    expect(lines.some((line) => line.type === 'change' && line.path === at('file4.txt'))).toBe(false);
  });
});

describe('subagents', () => {
  test('a child edit is attributed to the child', async () => {
    const files = new Map([[at('f.ts'), 'old']]);
    const capture = makeCapture('cap-sub', files);
    capture.onFrame({
      type: 'subagent_event',
      payload: { type: 'tool_execution_start', toolCallId: 's1', toolName: 'edit', args: { path: 'f.ts' }, agent: 'Child' },
    });
    await capture.flush();
    files.set(at('f.ts'), 'new');
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
