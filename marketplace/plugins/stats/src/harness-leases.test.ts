/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The reader for Kabmo's ACP leases.
 *
 * The cases pinned here are the ones that fail SILENTLY: a malformed record
 * that is accepted names a row after a chat that does not exist, and a missing
 * directory that throws takes the whole sample down instead of drawing the omp
 * rows the panel can still measure.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { harnessLeasesDir, readHarnessLeases } from './harness-leases';

let dir = '';
let originalDataDir: string | undefined;

beforeEach(() => {
  originalDataDir = Bun.env.KABMO_DATA_DIR;
  dir = mkdtempSync(join(tmpdir(), 'kabmo-stats-leases-'));
});

afterEach(() => {
  if (originalDataDir === undefined) delete Bun.env.KABMO_DATA_DIR;
  else Bun.env.KABMO_DATA_DIR = originalDataDir;
  rmSync(dir, { recursive: true, force: true });
});

function write(name: string, value: unknown): void {
  writeFileSync(join(dir, name), typeof value === 'string' ? value : JSON.stringify(value));
}

const valid = {
  pid: 101,
  sessionId: 'sess-1',
  harness: 'claude',
  label: 'claude',
  cwd: '/p',
  state: 'session',
  startedAt: 1_700_000_000_000,
  title: 'Fix the bug',
};

describe('readHarnessLeases', () => {
  test('a valid record is read by pid', () => {
    write('101.json', valid);
    const leases = readHarnessLeases(dir);
    expect(leases.get(101)?.title).toBe('Fix the bug');
    expect(leases.get(101)?.harness).toBe('claude');
  });

  test('a missing directory is an empty map, not a throw', () => {
    expect(readHarnessLeases(join(dir, 'nope')).size).toBe(0);
  });

  test('a malformed record is dropped rather than half-read', () => {
    write('101.json', { ...valid, state: 'running' });
    write('102.json', { ...valid, pid: 0 });
    write('103.json', { ...valid, startedAt: 'yesterday' });
    write('104.json', '{not json');
    write('105.json', { ...valid, label: '' });
    expect(readHarnessLeases(dir).size).toBe(0);
  });

  test('a non-json file in the directory is ignored', () => {
    write('notes.txt', 'hello');
    write('101.json', valid);
    expect(readHarnessLeases(dir).size).toBe(1);
  });
});

describe('harnessLeasesDir', () => {
  test('honours KABMO_DATA_DIR, the same override the server reads', () => {
    Bun.env.KABMO_DATA_DIR = dir;
    expect(harnessLeasesDir()).toBe(join(dir, 'run', 'harness-sessions'));
  });
});
