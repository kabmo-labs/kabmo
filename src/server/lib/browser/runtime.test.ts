/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { findProjectRuntimeDir, isTcpPortLive } from '@/server/lib/browser/runtime';

const tempRoots: string[] = [];
const savedEnv: Record<string, string | undefined> = {};

/** The daemon tree the scan reads: `$XDG_STATE_HOME/omp/run/daemons`. */
function runtimeRoot(): string {
  return join(Bun.env.XDG_STATE_HOME!, 'omp', 'run', 'daemons');
}

async function makeRuntimeDir(name: string): Promise<string> {
  const dir = join(runtimeRoot(), name);
  await fs.promises.mkdir(join(dir, 'omp.browser.headless.profile'), { recursive: true });
  await Bun.write(join(dir, 'scope.json'), JSON.stringify({ projectDir: '/tmp/fake-project' }));
  return dir;
}

async function writeDevToolsActivePort(runtimeDir: string, port: number, wsPath: string): Promise<void> {
  await Bun.write(join(runtimeDir, 'omp.browser.headless.profile', 'DevToolsActivePort'), `${port}\n${wsPath}\n`);
}

beforeEach(async () => {
  // `getConfigRoot()` is `homedir()/PI_CONFIG_DIR`, and `os.homedir()` is
  // snapshotted at process start — a runtime `HOME` change is invisible, so the
  // config root cannot be moved out of the developer's real home. Point
  // `PI_CONFIG_DIR` at a name that does not exist (the scan skips a missing
  // root) and put the daemon tree under a temp `XDG_STATE_HOME` instead: the
  // suite then writes nothing into `$HOME`. A uniquely named config dir inside
  // the real home was the previous isolation, and it left a directory behind
  // whenever the run died before `afterAll`.
  savedEnv.PI_CONFIG_DIR = Bun.env.PI_CONFIG_DIR;
  savedEnv.XDG_STATE_HOME = Bun.env.XDG_STATE_HOME;
  const stateRoot = fs.mkdtempSync(join(tmpdir(), 'kabmo-browser-runtime-'));
  tempRoots.push(stateRoot);
  Bun.env.PI_CONFIG_DIR = `.omp-browser-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  Bun.env.XDG_STATE_HOME = stateRoot;
  await fs.promises.mkdir(runtimeRoot(), { recursive: true });
});

afterEach(() => {
  if (savedEnv.PI_CONFIG_DIR === undefined) delete Bun.env.PI_CONFIG_DIR;
  else Bun.env.PI_CONFIG_DIR = savedEnv.PI_CONFIG_DIR;
  if (savedEnv.XDG_STATE_HOME === undefined) delete Bun.env.XDG_STATE_HOME;
  else Bun.env.XDG_STATE_HOME = savedEnv.XDG_STATE_HOME;
});

afterAll(() => {
  for (const root of tempRoots) fs.rmSync(root, { recursive: true, force: true });
});

describe('isTcpPortLive', () => {
  test('true for a listening port', async () => {
    const server = Bun.listen({ hostname: '127.0.0.1', port: 0, socket: { data() {}, close() {}, error() {} } });
    try {
      expect(await isTcpPortLive(server.port)).toBe(true);
    } finally {
      server.stop(true);
    }
  });

  test('false for a closed port', async () => {
    // Grab a free port, then release it so nothing listens there.
    const server = Bun.listen({ hostname: '127.0.0.1', port: 0, socket: { data() {}, close() {}, error() {} } });
    const port = server.port;
    server.stop(true);
    expect(await isTcpPortLive(port)).toBe(false);
  });
});

describe('findProjectRuntimeDir', () => {
  test('returns endpoint for a live daemon', async () => {
    const runtimeDir = await makeRuntimeDir('live');
    const server = Bun.listen({ hostname: '127.0.0.1', port: 0, socket: { data() {}, close() {}, error() {} } });
    try {
      await writeDevToolsActivePort(runtimeDir, server.port, '/devtools/browser/live-id');
      const found = await findProjectRuntimeDir('/tmp/fake-project');
      expect(found).not.toBeNull();
      expect(found?.port).toBe(server.port);
      expect(found?.wsUrl).toBe(`ws://127.0.0.1:${server.port}/devtools/browser/live-id`);
      expect(found?.daemonName).toBe('omp.browser.headless');
    } finally {
      server.stop(true);
    }
  });

  test('rejects a stale DevToolsActivePort whose port is dead', async () => {
    const runtimeDir = await makeRuntimeDir('stale');
    const server = Bun.listen({ hostname: '127.0.0.1', port: 0, socket: { data() {}, close() {}, error() {} } });
    const port = server.port;
    server.stop(true);
    await writeDevToolsActivePort(runtimeDir, port, '/devtools/browser/dead-id');
    expect(await findProjectRuntimeDir('/tmp/fake-project')).toBeNull();
  });

  test('returns null for an unknown project', async () => {
    await makeRuntimeDir('other');
    const server = Bun.listen({ hostname: '127.0.0.1', port: 0, socket: { data() {}, close() {}, error() {} } });
    try {
      await writeDevToolsActivePort(join(runtimeRoot(), 'other'), server.port, '/devtools/browser/other');
      expect(await findProjectRuntimeDir('/tmp/never-registered')).toBeNull();
    } finally {
      server.stop(true);
    }
  });
});
