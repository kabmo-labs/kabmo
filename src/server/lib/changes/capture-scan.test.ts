/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The scan's same-content dedupe.
 *
 * A later opaque command's scan sees every file in the cwd, including ones an
 * earlier call already recorded. If the current session's last record for the
 * path holds the same content, the scan must not journal it again.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { ChangeCapture } from '@/server/lib/changes/capture.server';
import { ChangeJournal } from '@/server/lib/changes/journal.server';
import { HOME, REPO, makeCapture, records } from '@/server/lib/changes/capture-test-util';

function at(relative: string): string {
  return path.join(REPO, relative);
}

let dataDir = '';
let original: string | undefined;

beforeAll(async () => {
  original = Bun.env.KABMO_DATA_DIR;
  dataDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'kabmo-changes-scan-'));
  Bun.env.KABMO_DATA_DIR = dataDir;
});

afterAll(async () => {
  if (original === undefined) delete Bun.env.KABMO_DATA_DIR;
  else Bun.env.KABMO_DATA_DIR = original;
  await fsp.rm(dataDir, { recursive: true, force: true });
});

describe('scan dedupe', () => {
  test('a scan skips a path the current session already recorded with the same content', async () => {
    const file = path.join(REPO, 'same.txt');
    const journal = new ChangeJournal('cap-same', REPO);
    await journal.recordChange({
      at: Date.now(), agent: 'Main', tool: 'bash', op: 'create', path: file,
      displayPath: 'same.txt', before: null, after: 'python', source: 'trace',
    });
    await journal.flush();

    const scans = [
      { root: REPO, dirty: new Map([[file, 'old']]), truncated: false },
      { root: REPO, dirty: new Map([[file, 'python']]), truncated: false },
    ];
    const capture = new ChangeCapture({
      journal,
      cwd: REPO,
      home: HOME,
      takeScan: async () => scans.shift() ?? null,
      readHead: async () => null,
    });
    capture.onFrame({
      type: 'tool_execution_start',
      toolCallId: 'c1',
      toolName: 'bash',
      args: { command: "python3 - <<'PY'\nopen('same.txt','w').write('python')\nPY" },
    });
    await capture.flush();
    capture.onFrame({
      type: 'tool_execution_end',
      toolCallId: 'c1',
      toolName: 'bash',
      result: { details: { trace: { status: 0, units: [{ nodes: [{ k: 'simple', argv: ['python3', '-'], st: 0 }] }] } } },
    });
    await capture.flush();

    const changes = (await records('cap-same')).filter((line) => line.type === 'change' && line.path === file);
    expect(changes.length).toBe(1);
  });
});

describe('directory scan', () => {
  test('a python3 script in a non-git cwd is reconciled from the directory scan', async () => {
    const files = new Map<string, string>();
    const scans = [
      { root: REPO, dirty: new Map<string, string | null>(), truncated: false },
      { root: REPO, dirty: new Map([[at('file4.txt'), 'python']]), truncated: false },
    ];
    const capture = makeCapture('cap-dir-scan', files, {
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

    const lines = await records('cap-dir-scan');
    const change = lines.find((line) => line.type === 'change');
    expect(change?.type).toBe('change');
    if (change?.type !== 'change') throw new Error('expected a change');
    expect(change.before).toBeNull();
    expect(typeof change.after).toBe('string');
    expect(change.source).toBe('scan');
    expect(lines.some((line) => line.type === 'note' && line.reason === 'opaque-command')).toBe(true);
  });
});

describe('directory scan race', () => {
  test('a file created before the start scan is still a create', async () => {
    const files = new Map([[at('race4.txt'), 'python']]);
    const scans = [
      { root: REPO, dirty: new Map([[at('race4.txt'), 'python']]), truncated: false },
      { root: REPO, dirty: new Map([[at('race4.txt'), 'python']]), truncated: false },
    ];
    const capture = makeCapture('cap-dir-race', files, {
      takeScan: async () => scans.shift() ?? null,
      readHead: async () => null,
      statFile: async (absolute) =>
        files.has(absolute)
          ? { mtimeMs: Date.now() + 1000, size: files.get(absolute)?.length ?? 0, birthtimeMs: Date.now() + 1000, isDirectory: false }
          : null,
    });
    capture.onFrame({
      type: 'tool_execution_start',
      toolCallId: 'c1',
      toolName: 'bash',
      args: { command: "python3 - <<'PY'\nopen('race4.txt','w').write('python')\nPY" },
    });
    await capture.flush();
    capture.onFrame({
      type: 'tool_execution_end',
      toolCallId: 'c1',
      toolName: 'bash',
      result: { details: { trace: { status: 0, units: [{ nodes: [{ k: 'simple', argv: ['python3', '-'], st: 0 }] }] } } },
    });
    await capture.flush();

    const change = (await records('cap-dir-race')).find((line) => line.type === 'change');
    expect(change?.type).toBe('change');
    if (change?.type !== 'change') throw new Error('expected a change');
    expect(change.before).toBeNull();
    expect(change.source).toBe('scan');
  });
});

