/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'fs';
import { homedir } from 'os';
import { join } from 'path';

import { findProjectRuntimeDir, isTcpPortLive } from '@/server/lib/browser/runtime';

const tempRoots: string[] = [];
const savedEnv: Record<string, string | undefined> = {};

async function makeRuntimeDir(name: string): Promise<string> {
  const dir = join(homedir(), Bun.env.PI_CONFIG_DIR!, 'run', 'daemons', name);
  await fs.promises.mkdir(join(dir, 'omp.browser.headless.profile'), { recursive: true });
  await Bun.write(join(dir, 'scope.json'), JSON.stringify({ projectDir: '/tmp/fake-project' }));
  return dir;
}

async function writeDevToolsActivePort(runtimeDir: string, port: number, wsPath: string): Promise<void> {
  await Bun.write(join(runtimeDir, 'omp.browser.headless.profile', 'DevToolsActivePort'), `${port}\n${wsPath}\n`);
}

beforeEach(async () => {
  // getConfigRoot() = homedir()/getConfigDirName(), and os.homedir() is
  // snapshotted at process start — a runtime HOME change is invisible.
  // PI_CONFIG_DIR is a *relative name* joined onto homedir, so isolate via a
  // uniquely named config dir inside the real home.
  savedEnv.PI_CONFIG_DIR = Bun.env.PI_CONFIG_DIR;
  savedEnv.XDG_STATE_HOME = Bun.env.XDG_STATE_HOME;
  const name = `.omp-browser-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  tempRoots.push(join(homedir(), name));
  await fs.promises.mkdir(join(homedir(), name, 'run', 'daemons'), { recursive: true });
  Bun.env.PI_CONFIG_DIR = name;
  Bun.env.XDG_STATE_HOME = '';
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
      await writeDevToolsActivePort(
        join(homedir(), Bun.env.PI_CONFIG_DIR!, 'run', 'daemons', 'other'),
        server.port,
        '/devtools/browser/other',
      );
      expect(await findProjectRuntimeDir('/tmp/never-registered')).toBeNull();
    } finally {
      server.stop(true);
    }
  });
});
