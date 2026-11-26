/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The presence badge must agree with the roster it opens.
 *
 * The sibling artifacts directory holds omp's own per-session files beside the
 * subagent transcripts, and `changes.jsonl` (the tool-call log) ends in
 * `.jsonl` like a transcript does. Counting it made every session that ran a
 * tool draw a chevron whose branch was empty — the roster is derived from the
 * parent's `task` toolResults, and there are none. These tests pin the rule
 * that replaced the extension check:
 *
 *  - a sibling `.jsonl` counts only when its header names a `parentSession`;
 *  - a `changes.jsonl` that merely QUOTES `parentSession` in a label does not;
 *  - a verdict saved under the old rule is not read back (the rule version is
 *    part of the cache key), so the phantom chevron clears on the next load.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'fs';
import { dirname, join } from 'path';
import { tmpdir } from 'node:os';

import { getDb } from '@kabmo-labs/kabmo-db/lifecycle';
import { isolateDb, releaseDb } from '@/test-support/isolated-db';
import { clearSubagentPresenceCache, sessionHasSubagents } from './presence';
import { writePresenceVerdict } from '@kabmo-labs/kabmo-omp/session-runtime/subagent-presence-store';

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = fs.mkdtempSync(join(tmpdir(), 'presence-rule-'));
  tempDirs.push(dir);
  return dir;
}

function writeSession(name: string, lines: unknown[]): string {
  const file = join(tempDir(), name);
  fs.mkdirSync(dirname(file), { recursive: true });
  fs.writeFileSync(file, `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`);
  return file;
}

function header(): Record<string, unknown> {
  return { type: 'session', version: 3, id: 's1', cwd: '/tmp/proj', timestamp: '2026-09-01T00:00:00.000Z' };
}

function taskResult(): Record<string, unknown> {
  return {
    type: 'message',
    timestamp: '2026-09-01T00:00:10.000Z',
    message: { role: 'toolResult', toolName: 'task', details: { progress: [{ id: 'AlphaBeta', agent: 'task', status: 'running' }] } },
  };
}

function writeSibling(file: string, name: string, lines: unknown[]): void {
  const dir = join(dirname(file), file.slice(dirname(file).length + 1, -'.jsonl'.length));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(join(dir, name), `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`);
}

beforeEach(async () => {
  await isolateDb();
  await getDb();
  clearSubagentPresenceCache();
});

afterEach(async () => {
  clearSubagentPresenceCache();
  await releaseDb();
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
  tempDirs.length = 0;
});

describe('subagent presence rule', () => {
  test('a sibling changes.jsonl is not a subagent', async () => {
    const file = writeSession('tool-run.jsonl', [header()]);
    writeSibling(file, 'changes.jsonl', [
      { type: 'call', agent: 'Main', tool: 'bash', start: 1, end: 2, label: 'ls' },
    ]);
    expect(await sessionHasSubagents(file, 'entry-1')).toBe(false);
  });

  test('a changes.jsonl that quotes parentSession in a label is still not a subagent', async () => {
    const file = writeSession('quoted.jsonl', [header()]);
    writeSibling(file, 'changes.jsonl', [
      { type: 'call', agent: 'Main', tool: 'bash', start: 1, end: 2, label: 'rg "parentSession" src' },
    ]);
    expect(await sessionHasSubagents(file, 'entry-1')).toBe(false);
  });

  test('a sibling transcript whose header names its parent is a subagent', async () => {
    const file = writeSession('spawned.jsonl', [header()]);
    writeSibling(file, 'AlphaBeta.jsonl', [
      { type: 'title', v: 1, title: '' },
      { type: 'session', version: 3, id: 'child', cwd: '/tmp/proj', parentSession: file },
    ]);
    expect(await sessionHasSubagents(file, 'entry-1')).toBe(true);
  });

  test('a task toolResult in the parent transcript is still a subagent', async () => {
    const file = writeSession('task-result.jsonl', [header(), taskResult()]);
    expect(await sessionHasSubagents(file, 'entry-1')).toBe(true);
  });

  test('a verdict saved under the old rule is not read back', async () => {
    const file = writeSession('stale.jsonl', [header()]);
    // The pre-v2 key: no rule version, and `true` from the changes.jsonl bug.
    await writePresenceVerdict(file, 'entry-1:0', true);
    expect(await sessionHasSubagents(file, 'entry-1')).toBe(false);
  });
});
