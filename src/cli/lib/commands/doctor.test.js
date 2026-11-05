// `kabmo doctor`'s report, and the exit code that decides whether CI breaks.
//
// The interesting decisions are not the table: they are which facts are read
// from the running install rather than guessed, and what counts as a FAILURE.
// A registry outage or an unwritten database must not make `doctor` red, while
// a missing binary must — otherwise the one command whose job is to explain a
// refusal would itself be unreadable.
//
// The omp binary is a real script in a temp directory (that is what
// `resolveOmpBin` probes and `omp --version` parses), and the registry is a
// stubbed `fetch`, so nothing here touches the network or the developer's omp.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { collectReport, exitCodeFor } from '@/cli/lib/commands/doctor.js';
import { invalidateOmpCliCache } from '@/server/lib/omp/core/cli';

const originalFetch = Bun.fetch;
const realEnv = {
  KABMO_OMP_BIN: Bun.env.KABMO_OMP_BIN,
  MOCK: Bun.env.MOCK,
  KABMO_DATA_DIR: Bun.env.KABMO_DATA_DIR,
  PI_CONFIG_DIR: Bun.env.PI_CONFIG_DIR,
  PI_CODING_AGENT_DIR: Bun.env.PI_CODING_AGENT_DIR,
};

/** A runnable `omp` that names itself the way the real one does. */
function fakeOmp(version = '18.16.0') {
  const dir = mkdtempSync(join(tmpdir(), 'kabmo-doctor-'));
  const path = join(dir, 'omp');
  writeFileSync(path, `#!/bin/sh\necho "omp/${version}"\n`);
  chmodSync(path, 0o755);
  return path;
}

function stubRegistry(version = '18.16.0', status = 200) {
  globalThis.fetch = async () => new Response(JSON.stringify({ version }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  Bun.env.KABMO_DATA_DIR = mkdtempSync(join(tmpdir(), 'kabmo-doctor-data-'));
  Bun.env.MOCK = 'false';
  invalidateOmpCliCache();
  stubRegistry();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const [key, value] of Object.entries(realEnv)) {
    if (value === undefined) delete Bun.env[key];
    else Bun.env[key] = value;
  }
  invalidateOmpCliCache();
});

describe('collectReport', () => {
  test('reports the resolved binary and the version it names itself', async () => {
    Bun.env.KABMO_OMP_BIN = fakeOmp('18.20.1');
    const report = await collectReport({ instances: [] });
    expect(report.omp.installed).toBe(true);
    expect(report.omp.bin).toBe(Bun.env.KABMO_OMP_BIN);
    expect(report.omp.version).toBe('18.20.1');
    expect(report.omp.error).toBeNull();
  });

  test('a missing binary is reported as absent, not as an empty version', async () => {
    Bun.env.KABMO_OMP_BIN = join(mkdtempSync(join(tmpdir(), 'kabmo-doctor-miss-')), 'omp');
    const report = await collectReport({ instances: [] });
    expect(report.omp.bin).toBeNull();
    expect(report.omp.installed).toBe(false);
    expect(report.omp.error).toBe('omp binary not found');
  });

  test('the data directory is the one this process resolves, marked when absent', async () => {
    Bun.env.KABMO_OMP_BIN = fakeOmp();
    const report = await collectReport({ instances: [] });
    expect(report.data.dir).toBe(Bun.env.KABMO_DATA_DIR);
    // Nothing has opened the database, so it cannot exist yet — and doctor must
    // not create it (opening a handle CREATES the file).
    expect(report.data.database).toContain('(missing)');
  });

  test('the install method comes from the path this copy runs out of', async () => {
    Bun.env.KABMO_OMP_BIN = fakeOmp();
    const report = await collectReport({ pkgRoot: process.cwd(), instances: [] });
    // This suite runs from the repository checkout.
    expect(report.kabmo.installMethod).toBe('git');
    expect(report.kabmo.package).toBe(process.cwd());
  });

  test('instances are reported, not probed', async () => {
    Bun.env.KABMO_OMP_BIN = fakeOmp();
    const report = await collectReport({ instances: [{ port: 3000, pid: 42, mode: 'prod' }] });
    expect(report.instances).toEqual([{ port: 3000, pid: 42, mode: 'prod' }]);
  });
});

describe('exitCodeFor', () => {
  const base = {
    mock: false,
    omp: { bin: '/usr/local/bin/omp', version: '18.16.0' },
    kabmo: { error: null },
  };

  test('a resolvable, readable binary is healthy', () => {
    expect(exitCodeFor(base)).toBe(0);
  });

  test('a missing binary fails', () => {
    expect(exitCodeFor({ ...base, omp: { bin: null, version: null } })).toBe(1);
  });

  test('a binary whose version cannot be read fails', () => {
    expect(exitCodeFor({ ...base, omp: { bin: '/usr/local/bin/omp', version: null } })).toBe(1);
  });

  // MOCK mode exists precisely to run without omp, so the gate that refuses to
  // start is disabled there and this must agree with it.
  test('mock mode is healthy without a binary', () => {
    expect(exitCodeFor({ ...base, mock: true, omp: { bin: null, version: null } })).toBe(0);
  });

  // A registry outage leaves `latest: null`; that is a note, not a failure —
  // an air-gapped install is still a working install.
  test('an unreadable registry is not a failure', () => {
    expect(exitCodeFor({ ...base, kabmo: { error: 'No Kabmo release could be resolved' } })).toBe(0);
  });
});
