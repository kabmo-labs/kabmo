/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The cloudflared lifecycle, driven through a stand-in.
 *
 * A real named tunnel needs an account, a domain and a credentials file, so the
 * start path is unreachable on a machine that has none — which is exactly the
 * path that would otherwise ship untested. The stand-in is a script that stays
 * alive, which is all `startCloudflared` requires: it records the process, derives
 * the public URL from the config's hostname, and reports liveness from the
 * process's own exit code.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  cloudflaredAlive,
  runningTunnelUrl,
  startCloudflared,
  stopCloudflared,
} from '@/server/lib/connect/cloudflared.server';

// The stand-in is a `#!/bin/sh` script, so the cases that spawn it are
// POSIX-only: Windows cannot execute it, and they would fail on the spawn
// instead of on the lifecycle they exist to measure. The Linux gate covers it.
const posixOnly = process.platform !== 'win32';

const dirs: string[] = [];

function fakeCloudflared(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kabmo-cf-bin-'));
  dirs.push(dir);
  const file = path.join(dir, 'cloudflared');
  // Stays alive until killed, like the real `tunnel run`.
  fs.writeFileSync(file, '#!/bin/sh\nexec sleep 30\n');
  fs.chmodSync(file, 0o755);
  return file;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('cloudflared lifecycle', () => {
  test.skipIf(!posixOnly)('starting records the public URL and reports the process alive', async () => {
    const binary = fakeCloudflared();
    const port = 39_101;
    const outcome = await startCloudflared(binary, '/tmp/config.yml', 'kabmo.example.com', port);

    expect(outcome.ok).toBe(true);
    expect(outcome.url).toBe('https://kabmo.example.com');
    expect(runningTunnelUrl(port)).toBe('https://kabmo.example.com');
    expect(cloudflaredAlive(port)).toBe(true);

    stopCloudflared(port);
    expect(cloudflaredAlive(port)).toBe(false);
    expect(runningTunnelUrl(port)).toBeNull();
  });

  test.skipIf(!posixOnly)('starting twice for one port reuses the running tunnel', async () => {
    const binary = fakeCloudflared();
    const port = 39_102;
    await startCloudflared(binary, '/tmp/config.yml', 'a.example.com', port);
    const second = await startCloudflared(binary, '/tmp/config.yml', 'b.example.com', port);

    // The second call must not spawn a second process, and must not claim a
    // different hostname than the one actually running.
    expect(second.url).toBe('https://a.example.com');
    stopCloudflared(port);
  });

  test('stopping a tunnel that was never started is not an error', () => {
    expect(stopCloudflared(39_103)).toEqual({ ok: true, reason: null });
    expect(cloudflaredAlive(39_103)).toBe(false);
  });

  test('a binary that cannot be spawned reports the reason', async () => {
    const outcome = await startCloudflared('/nonexistent/cloudflared', '/tmp/config.yml', 'x.example.com', 39_104);
    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toBeTruthy();
    expect(cloudflaredAlive(39_104)).toBe(false);
  });
});
