/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The capture layer, at the tool adapter: an `edit`, a `write` and an
 * `apply_patch` become journal records, an ACP agent's arg spellings are read,
 * and a write under the OS temp dir or a build directory is not journaled.
 * The shell half (trace, scan, subagents) is `capture-shell.test.ts`.
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

describe('apply_patch', () => {
  test('a patch names its paths and the change is recorded', async () => {
    const files = new Map([[at('a.txt'), 'old']]);
    const capture = makeCapture('cap-patch', files);
    capture.onFrame({
      type: 'tool_execution_start',
      toolCallId: 'c1',
      toolName: 'apply_patch',
      args: { input: '*** Begin Patch\n*** Update File: a.txt\n@@\n-old\n+new\n*** End Patch' },
    });
    await capture.flush();
    files.set(at('a.txt'), 'new');
    capture.onFrame({ type: 'tool_execution_end', toolCallId: 'c1', toolName: 'apply_patch' });
    await capture.flush();

    const change = (await records('cap-patch')).find((line) => line.type === 'change');
    expect(change?.type).toBe('change');
    if (change?.type !== 'change') throw new Error('expected a change');
    expect(change.op).toBe('update');
    expect(change.path).toBe(at('a.txt'));
  });
});

describe('ACP shell tools', () => {
  test('exec_command with a command is captured as a shell call', async () => {
    const files = new Map<string, string>();
    const capture = makeCapture('cap-acp-exec', files);
    capture.onFrame({
      type: 'tool_execution_start',
      toolCallId: 'c1',
      toolName: 'exec_command',
      args: { command: 'printf hello > a.txt', cwd: REPO },
    });
    await capture.flush();
    files.set(at('a.txt'), 'hello');
    capture.onFrame({ type: 'tool_execution_end', toolCallId: 'c1', toolName: 'exec_command' });
    await capture.flush();

    const change = (await records('cap-acp-exec')).find((line) => line.type === 'change');
    expect(change?.type).toBe('change');
    if (change?.type !== 'change') throw new Error('expected a change');
    expect(change.op).toBe('create');
    expect(change.path).toBe(at('a.txt'));
  });

  test('a shell tool named after the command is captured', async () => {
    const files = new Map([[at('rm.txt'), 'hello']]);
    const scans = [
      { root: REPO, dirty: new Map([[at('rm.txt'), 'hello']]), truncated: false },
      { root: REPO, dirty: new Map<string, string | null>(), truncated: false },
    ];
    const capture = makeCapture('cap-acp-rm', files, {
      takeScan: async () => scans.shift() ?? null,
      readHead: async () => null,
    });
    capture.onFrame({
      type: 'tool_execution_start',
      toolCallId: 'c1',
      toolName: 'rm -f rm.txt',
      args: { command: "/bin/zsh -lc 'rm -f rm.txt'", cwd: REPO },
    });
    await capture.flush();
    files.delete(at('rm.txt'));
    capture.onFrame({ type: 'tool_execution_end', toolCallId: 'c1', toolName: 'rm -f rm.txt' });
    await capture.flush();

    const change = (await records('cap-acp-rm')).find((line) => line.type === 'change');
    expect(change?.type).toBe('change');
    if (change?.type !== 'change') throw new Error('expected a change');
    expect(change.op).toBe('delete');
    expect(change.path).toBe(at('rm.txt'));
  });
});

describe('ACP arg spellings', () => {
  test('a write with filePath is recorded', async () => {
    const files = new Map<string, string>();
    const capture = makeCapture('cap-acp-write', files);
    capture.onFrame({
      type: 'tool_execution_start',
      toolCallId: 'c1',
      toolName: 'write',
      args: { filePath: 'a.txt', content: 'hello' },
    });
    await capture.flush();
    files.set(at('a.txt'), 'hello');
    capture.onFrame({ type: 'tool_execution_end', toolCallId: 'c1', toolName: 'write' });
    await capture.flush();

    const change = (await records('cap-acp-write')).find((line) => line.type === 'change');
    expect(change?.type).toBe('change');
    if (change?.type !== 'change') throw new Error('expected a change');
    expect(change.op).toBe('create');
    expect(change.path).toBe(at('a.txt'));
  });

  test('an edit with oldString/newString is reconstructed', async () => {
    const files = new Map([[at('b.txt'), 'old']]);
    const capture = makeCapture('cap-acp-edit', files);
    capture.onFrame({
      type: 'tool_execution_start',
      toolCallId: 'c1',
      toolName: 'edit',
      args: { filePath: 'b.txt', oldString: 'old', newString: 'new' },
    });
    await capture.flush();
    files.set(at('b.txt'), 'new');
    capture.onFrame({ type: 'tool_execution_end', toolCallId: 'c1', toolName: 'edit' });
    await capture.flush();

    const change = (await records('cap-acp-edit')).find((line) => line.type === 'change');
    expect(change?.type).toBe('change');
    if (change?.type !== 'change') throw new Error('expected a change');
    expect(change.op).toBe('update');
    expect(change.path).toBe(at('b.txt'));
  });
});

