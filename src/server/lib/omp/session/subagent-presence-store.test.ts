/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The saved presence verdict — the half of the probe that survives a restart.
 *
 * In-process caching already answered "cheap after the first call"; what this
 * pins is the case the old module could not: a NEW process, whose sidebar load
 * used to stream every transcript again (measured 1.38 GB of reads on a
 * 1349-file agent directory). The verdict is only reusable for the exact file
 * version that produced it, so both halves of the key are exercised:
 *
 *  - same version, different file content → the saved answer stands (this is
 *    what a restart looks like);
 *  - new version → the transcript is read again, and the saved answer is
 *    replaced.
 *
 * The probe must also stay usable with NO database open: it runs in unit
 * suites and in any caller that has not opened the store yet, and it must
 * never create one.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'fs';
import { dirname, join } from 'path';
import { tmpdir } from 'node:os';

import { closeDb, getDb } from '@/server/db.server';
import { isolateDb, releaseDb } from '@/test-support/isolated-db';
import { clearSubagentPresenceCache, sessionHasSubagents } from '@/server/lib/omp/session/subagent-presence';
import { readPresenceVerdict } from '@/server/lib/omp/session/subagent-presence-store';

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = fs.mkdtempSync(join(tmpdir(), 'presence-store-'));
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

function withSubagent(): Record<string, unknown> {
  return {
    type: 'message',
    timestamp: '2026-09-01T00:00:10.000Z',
    message: { role: 'toolResult', toolName: 'task', details: { progress: [{ id: 'AlphaBeta', agent: 'task', status: 'running' }] } },
  };
}

beforeEach(async () => {
  await isolateDb();
  // Opening is what creates the schema (and drops this suite's in-process map).
  await getDb();
  clearSubagentPresenceCache();
});

afterEach(async () => {
  clearSubagentPresenceCache();
  await releaseDb();
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
  tempDirs.length = 0;
});

describe('saved presence verdict', () => {
  test('answers from the database for the same version, even when the file changed', async () => {
    const file = writeSession('same-version.jsonl', [header(), withSubagent()]);
    expect(await sessionHasSubagents(file, 'entry-1')).toBe(true);

    // What a restart does: the in-process map is gone...
    clearSubagentPresenceCache();
    // ...and the file no longer holds the entry the verdict came from. Only a
    // saved verdict can still answer `true` here.
    fs.writeFileSync(file, `${JSON.stringify(header())}\n`);
    expect(await sessionHasSubagents(file, 'entry-1')).toBe(true);
  });

  test('a new version re-reads the file and replaces the saved verdict', async () => {
    const file = writeSession('new-version.jsonl', [header(), withSubagent()]);
    expect(await sessionHasSubagents(file, 'entry-1')).toBe(true);
    // The transcript loses the entry AND the version moves: only a re-read can
    // answer `false`, and it must replace what the store held.
    fs.writeFileSync(file, `${JSON.stringify(header())}\n`);
    clearSubagentPresenceCache();
    expect(await sessionHasSubagents(file, 'entry-2')).toBe(false);
    // The new verdict is what a restart sees for that version.
    clearSubagentPresenceCache();
    fs.writeFileSync(file, `${JSON.stringify(header())}\n${JSON.stringify(withSubagent())}\n`);
    expect(await sessionHasSubagents(file, 'entry-2')).toBe(false);
  });

  test('the false case is saved too — a restart must not re-scan a plain session', async () => {
    const file = writeSession('plain.jsonl', [header()]);
    expect(await sessionHasSubagents(file, 'entry-1')).toBe(false);
    // Same version, now holding an entry: a saved `false` answers without
    // reading the file again (this is the cheap path a restart needs).
    clearSubagentPresenceCache();
    fs.writeFileSync(file, `${JSON.stringify(header())}\n${JSON.stringify(withSubagent())}\n`);
    expect(await sessionHasSubagents(file, 'entry-1')).toBe(false);
  });

  test('a probe with no database open still answers, and saves nothing', async () => {
    const file = writeSession('no-db.jsonl', [header(), withSubagent()]);
    await closeDb();
    expect(await sessionHasSubagents(file, 'entry-1')).toBe(true);
    // Asking the store again is a miss, not an error: no handle means no cache.
    expect(await readPresenceVerdict(file, 'entry-1:0')).toBeNull();
  });
});