/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The lease the Stats panel reads to name an ACP chat.
 *
 * The two rules pinned here are the ones a reader cannot recover from a wrong
 * file: `startedAt` must survive the handshake (a claimed prewarm did not
 * restart), and a title update must reach the file the panel reads rather than
 * only the database it cannot.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { getHarnessLeasePath } from '@/server/lib/lifecycle/paths';
import {
  noteHarnessLease,
  pruneHarnessLeases,
  removeHarnessLease,
  updateHarnessLeaseTitle,
} from '@/server/lib/harness/session-lease.server';

let dir = '';
let originalDataDir: string | undefined;

beforeEach(() => {
  originalDataDir = Bun.env.KABMO_DATA_DIR;
  dir = mkdtempSync(join(tmpdir(), 'kabmo-harness-lease-'));
  Bun.env.KABMO_DATA_DIR = dir;
});

afterEach(() => {
  if (originalDataDir === undefined) delete Bun.env.KABMO_DATA_DIR;
  else Bun.env.KABMO_DATA_DIR = originalDataDir;
  rmSync(dir, { recursive: true, force: true });
});

function lease(pid: number): Record<string, unknown> {
  return JSON.parse(readFileSync(getHarnessLeasePath(pid), 'utf8')) as Record<string, unknown>;
}

describe('harness session lease', () => {
  test('a spawn writes the catalog label and the spawn time', () => {
    noteHarnessLease({ pid: 4242, harness: 'claude', cwd: '/p', state: 'starting' });
    const record = lease(4242);
    expect(record.label).toBe('claude');
    expect(record.state).toBe('starting');
    expect(record.sessionId).toBe('');
    expect(record.startedAt).toBeGreaterThan(0);
  });

  test('the handshake keeps the spawn time and records the session', () => {
    noteHarnessLease({ pid: 4243, harness: 'opencode', cwd: '/p', state: 'starting' });
    const spawnedAt = lease(4243).startedAt;
    noteHarnessLease({
      pid: 4243,
      harness: 'opencode',
      cwd: '/p',
      state: 'session',
      sessionId: 'sess-1',
      title: 'Fix it',
    });
    const record = lease(4243);
    expect(record.startedAt).toBe(spawnedAt);
    expect(record.state).toBe('session');
    expect(record.sessionId).toBe('sess-1');
    expect(record.title).toBe('Fix it');
  });

  test('a title update rewrites the lease that owns the session', () => {
    noteHarnessLease({ pid: 4244, harness: 'codex', cwd: '/p', state: 'session', sessionId: 'sess-2' });
    updateHarnessLeaseTitle('sess-2', 'Rename me');
    expect(lease(4244).title).toBe('Rename me');
  });

  test('a title for a session with no lease is a no-op', () => {
    expect(() => updateHarnessLeaseTitle('nobody', 'x')).not.toThrow();
  });

  test('removing a lease deletes the file', () => {
    noteHarnessLease({ pid: 4245, harness: 'pi', cwd: '/p', state: 'prewarm' });
    removeHarnessLease(4245);
    expect(existsSync(getHarnessLeasePath(4245))).toBe(false);
  });

  test('pruning drops a dead pid and keeps a live one', () => {
    noteHarnessLease({ pid: process.pid, harness: 'claude', cwd: '/p', state: 'session', sessionId: 'sess-live' });
    const deadPid = 2_147_483_647;
    writeFileSync(getHarnessLeasePath(deadPid), JSON.stringify({ pid: deadPid }));
    expect(pruneHarnessLeases()).toBe(1);
    expect(existsSync(getHarnessLeasePath(process.pid))).toBe(true);
    expect(existsSync(getHarnessLeasePath(deadPid))).toBe(false);
  });
});
