/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The instance registry, process identity, and who occupies a port.
 *
 * Two silent failures motivate every case. The registry is what makes a server
 * started outside the CLI (`bun run dev`) discoverable at all, so a record that
 * cannot round-trip — or a `listInstanceRecords` that skips a port file — makes
 * a live server invisible to `status` / `stop`. And PID identity is what keeps
 * a recycled PID from naming a stranger as the occupant: after an ungraceful
 * exit the recorded PID can belong to an unrelated process, so liveness alone
 * is not enough.
 *
 * `paths.ts` reads `OMPCHAMBER_DATA_DIR` per call, so pointing it at a temp
 * tree redirects the whole registry without touching `~/.ompchamber`.
 * Restored in `afterAll`.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { getProcessState, isProcessAlive } from '@/server/lib/lifecycle/identity';
import { getInstancePath, getRunDir } from '@/server/lib/lifecycle/paths';
import {
  listInstanceRecords,
  readInstanceRecord,
  removeInstanceRecord,
  writeInstanceRecord,
  type InstanceRecord,
} from '@/server/lib/lifecycle/instance';
import { describeOccupant, findOccupant } from '@/server/lib/lifecycle/occupant';
import { testPosix } from '@/test-support/platform';

let workRoot = '';
let originalDataDir: string | undefined;

beforeAll(() => {
  workRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ompchamber-lifecycle-test-'));
  originalDataDir = Bun.env.OMPCHAMBER_DATA_DIR;
  Bun.env.OMPCHAMBER_DATA_DIR = workRoot;
});

afterAll(() => {
  if (originalDataDir === undefined) delete Bun.env.OMPCHAMBER_DATA_DIR;
  else Bun.env.OMPCHAMBER_DATA_DIR = originalDataDir;
  fs.rmSync(workRoot, { recursive: true, force: true });
});

afterEach(() => {
  // Each test owns its port number, so clearing the run dir is the isolation.
  fs.rmSync(getRunDir(), { recursive: true, force: true });
});

/** A record with every field set, so partial merges are visible. */
function record(port: number, overrides: Partial<InstanceRecord> = {}): InstanceRecord {
  return {
    pid: 4242,
    port,
    host: 'localhost',
    mode: 'dev',
    launchMode: 'daemon',
    tray: false,
    tls: false,
    auth: false,
    startedAt: '2026-10-01T10:00:00.000Z',
    version: '0.5.0',
    ...overrides,
  };
}

/** Spawn a live child whose argv names ompchamber, so identity reads `matched`. */
function spawnMatched(): { pid: number; kill: () => void; exited: Promise<unknown>; dir: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ompchamber-fixture-'));
  const script = path.join(dir, 'ompchamber-fixture.sh');
  fs.writeFileSync(script, '#!/bin/sh\nsleep 30\n', { mode: 0o755 });
  const child = Bun.spawn([script], { stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' });
  return { pid: child.pid, kill: () => child.kill(), exited: child.exited, dir };
}

/** Spawn a live child whose command line is demonstrably not Kabmo. */
function spawnMismatched(): { pid: number; kill: () => void; exited: Promise<unknown> } {
  const child = Bun.spawn(['/bin/sh', '-c', 'sleep 30'], { stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' });
  return { pid: child.pid, kill: () => child.kill(), exited: child.exited };
}

describe('instance record round-trip', () => {
  test('writes and reads back every field, by number and by string port', () => {
    const value = record(4101, { mode: 'prod', launchMode: 'foreground' });
    expect(writeInstanceRecord(value)).toBe(true);
    expect(readInstanceRecord(4101)).toEqual(value);
    // The CLI passes whatever argv gave it, so the string form must work too.
    expect(readInstanceRecord('4101')).toEqual(value);
  });

  // `statSync().mode` has no meaning on Windows (a synthesised 0o666/0o444), so
  // the 0600 assertion is POSIX-only; the round-trip itself is covered above.
  testPosix('writes 0600 and leaves no temp file behind', () => {
    writeInstanceRecord(record(4102));
    expect(fs.statSync(getInstancePath(4102)).mode & 0o777).toBe(0o600);
    expect(fs.readdirSync(getRunDir()).some((name) => name.endsWith('.tmp'))).toBe(false);
  });

  test('a missing, malformed, or non-object record reads as null', () => {
    expect(readInstanceRecord(4199)).toBeNull();
    fs.writeFileSync(getInstancePath(4103), '{ not json');
    expect(readInstanceRecord(4103)).toBeNull();
    fs.writeFileSync(getInstancePath(4104), '"a string"');
    expect(readInstanceRecord(4104)).toBeNull();
  });

  test('a record missing pid/port is rejected outright', () => {
    fs.writeFileSync(getInstancePath(4105), JSON.stringify({ host: 'localhost', mode: 'dev' }));
    expect(readInstanceRecord(4105)).toBeNull();
    fs.writeFileSync(getInstancePath(4106), JSON.stringify({ pid: 'not-a-number', port: 4106 }));
    expect(readInstanceRecord(4106)).toBeNull();
  });

  test('untrusted enum/typed fields fall back to the documented defaults', () => {
    // Written by an older or newer install: every field the reader cannot trust
    // must become the safe default, never undefined.
    fs.writeFileSync(getInstancePath(4107), JSON.stringify({
      pid: 7,
      port: 4107,
      host: 123,
      mode: 'staging',
      launchMode: 'sideways',
      startedAt: 9,
      version: null,
    }));
    expect(readInstanceRecord(4107)).toEqual({
      pid: 7,
      port: 4107,
      host: 'localhost',
      mode: 'dev',
      launchMode: 'direct',
      // Not recorded by the older install that wrote this file: `false` is the
      // honest answer, and never a guess that the instance had a tray or TLS.
      tray: false,
      tls: false,
      auth: false,
      startedAt: '',
      version: '',
    });
  });

  test('a recorded tray and tls survive the round trip', () => {
    const value = record(4108, { tray: true, tls: true });
    expect(writeInstanceRecord(value)).toBe(true);
    expect(readInstanceRecord(4108)).toEqual(value);
    // A non-boolean is not a flag: only a literal `true` turns either on.
    fs.writeFileSync(getInstancePath(4119), JSON.stringify({ pid: 1, port: 4119, tray: 'yes', tls: 1 }));
    expect(readInstanceRecord(4119)).toMatchObject({ tray: false, tls: false });
  });

  test('removeInstanceRecord drops the record', () => {
    writeInstanceRecord(record(4109));
    removeInstanceRecord(4109);
    expect(readInstanceRecord(4109)).toBeNull();
  });
});

describe('listInstanceRecords', () => {
  test('returns every readable port record', () => {
    writeInstanceRecord(record(4110));
    writeInstanceRecord(record(4111, { mode: 'prod' }));
    expect(listInstanceRecords().map((entry) => entry.port).sort((a, b) => a - b)).toEqual([4110, 4111]);
  });

  test('skips files that are not <port>.json and records it cannot read', () => {
    writeInstanceRecord(record(4112));
    fs.writeFileSync(path.join(getRunDir(), 'notes.txt'), 'ignore me');
    fs.writeFileSync(path.join(getRunDir(), '4113.json'), '{ broken');
    expect(listInstanceRecords().map((entry) => entry.port)).toEqual([4112]);
  });

  test('an absent run directory yields an empty list', () => {
    fs.rmSync(getRunDir(), { recursive: true, force: true });
    expect(listInstanceRecords()).toEqual([]);
  });
});

describe('process identity', () => {
  test('rejects non-pid inputs without probing', () => {
    for (const pid of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(isProcessAlive(pid)).toBe(false);
      expect(getProcessState(pid)).toBe('dead');
    }
  });

  test('a PID that cannot exist is dead', () => {
    // Above macOS's 99999 ceiling and Linux's pid_max: no process to signal.
    expect(isProcessAlive(2_147_483_646)).toBe(false);
    expect(getProcessState(2_147_483_646)).toBe('dead');
  });

  testPosix('a live process whose command line names ompchamber is matched', async () => {
    const child = spawnMatched();
    try {
      expect(isProcessAlive(child.pid)).toBe(true);
      expect(getProcessState(child.pid)).toBe('matched');
    } finally {
      child.kill();
      await child.exited;
      fs.rmSync(child.dir, { recursive: true, force: true });
    }
  });

  testPosix('a live process that is not Kabmo is mismatched', async () => {
    const child = spawnMismatched();
    try {
      expect(isProcessAlive(child.pid)).toBe(true);
      expect(getProcessState(child.pid)).toBe('mismatched');
    } finally {
      child.kill();
      await child.exited;
    }
  });
});

describe('findOccupant with no listener on the port', () => {
  // Port 1 is privileged and nothing listens on it here, so the health probe
  // answers null and the record is the only possible source.
  const FREE_PORT = 1;

  test('a stale record (dead PID) is not an occupant', async () => {
    writeInstanceRecord(record(FREE_PORT, { pid: 2_147_483_646 }));
    expect(await findOccupant(FREE_PORT)).toBeNull();
  });

  testPosix('a live but mismatched PID is not an occupant', async () => {
    // A recycled PID: alive, but demonstrably not an Kabmo server.
    const child = spawnMismatched();
    try {
      writeInstanceRecord(record(FREE_PORT, { pid: child.pid }));
      expect(await findOccupant(FREE_PORT)).toBeNull();
    } finally {
      child.kill();
      await child.exited;
    }
  });

  test('no record and no listener means no occupant', async () => {
    expect(await findOccupant(FREE_PORT)).toBeNull();
  });

  testPosix('a live record is reported from the registry alone', async () => {
    // The case a deaf server (hung, suspended, still starting) depends on: the
    // record is the only source, and it must read as unconfirmed.
    const child = spawnMatched();
    try {
      writeInstanceRecord(record(FREE_PORT, { pid: child.pid, version: '9.9.9', launchMode: 'foreground' }));
      expect(await findOccupant(FREE_PORT)).toEqual({
        pid: child.pid,
        port: FREE_PORT,
        host: 'localhost',
        version: '9.9.9',
        mode: 'dev',
        launchMode: 'foreground',
        startedAt: '2026-10-01T10:00:00.000Z',
        source: 'registry',
        confirmedByHealth: false,
      });
    } finally {
      child.kill();
      await child.exited;
      fs.rmSync(child.dir, { recursive: true, force: true });
    }
  });
});

describe('describeOccupant', () => {
  const base = { pid: 1234, port: 1, source: 'probe' as const, confirmedByHealth: true };

  test('renders the full identity line', () => {
    expect(describeOccupant({ ...base, mode: 'dev', launchMode: 'direct', version: '0.5.0', uptime: 120 }))
      .toBe('pid 1234 (dev, direct, v0.5.0, up 2m)');
  });

  test('marks an occupant the health probe did not confirm', () => {
    // A registry-only occupant is unverified; the label is what stops a stale
    // record from reading as a confirmed server.
    expect(describeOccupant({ ...base, confirmedByHealth: false })).toBe('pid 1234 (unconfirmed)');
  });

  test('omits every absent detail, leaving just the PID', () => {
    expect(describeOccupant(base)).toBe('pid 1234');
  });

  test('formats the age as seconds, minutes, then hours and minutes', () => {
    expect(describeOccupant({ ...base, uptime: 45 })).toContain('up 45s');
    expect(describeOccupant({ ...base, uptime: 90 })).toContain('up 1m');
    expect(describeOccupant({ ...base, uptime: 3700 })).toContain('up 1h 1m');
  });

  test('derives the age from startedAt and drops an unusable one', () => {
    expect(describeOccupant({ ...base, startedAt: new Date(Date.now() - 600_000).toISOString() })).toContain('up 10m');
    // A clock skew that puts the start in the future has no age to report.
    expect(describeOccupant({ ...base, startedAt: new Date(Date.now() + 600_000).toISOString() })).toBe('pid 1234');
    expect(describeOccupant({ ...base, uptime: -1 })).toBe('pid 1234');
  });
});
