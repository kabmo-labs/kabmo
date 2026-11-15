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
 * alive and records its argv and the config it was handed: the start path must
 * spawn `tunnel --config <runtime copy> run`, the copy must name THIS port, and
 * the copy must be gone once the tunnel stops.
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

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kabmo-cf-'));
  dirs.push(dir);
  return dir;
}

const CONFIG = [
  'tunnel: 6ff42ae2-765d-4adf-8112-31c55c1551ef',
  'credentials-file: /home/me/.cloudflared/6ff42ae2.json',
  '',
  'ingress:',
  '  - hostname: kabmo.example.com',
  '    service: http://localhost:3000',
  '  - service: http_status:404',
  '',
].join('\n');

function writeConfig(text: string): string {
  const file = path.join(tempDir(), 'config.yml');
  fs.writeFileSync(file, text);
  return file;
}

/** Stays alive until killed, like the real `tunnel run`, and records its argv. */
function fakeCloudflared(): { binary: string; argsFile: string; configFile: string } {
  const dir = tempDir();
  const binary = path.join(dir, 'cloudflared');
  const argsFile = path.join(dir, 'args.txt');
  const configFile = path.join(dir, 'handed-config.yml');
  fs.writeFileSync(
    binary,
    [
      '#!/bin/sh',
      `args="${argsFile}"`,
      `cfg="${configFile}"`,
      ': > "$args.tmp"',
      'while [ $# -gt 0 ]; do',
      '  printf \'%s\\n\' "$1" >> "$args.tmp"',
      '  if [ "$1" = "--config" ]; then',
      '    shift',
      '    printf \'%s\\n\' "$1" >> "$args.tmp"',
      '    cp "$1" "$cfg" 2>/dev/null',
      '  fi',
      '  shift',
      'done',
      // Rename, so the reader never sees a half-written file.
      'mv "$args.tmp" "$args"',
      'exec sleep 30',
      '',
    ].join('\n'),
  );
  fs.chmodSync(binary, 0o755);
  return { binary, argsFile, configFile };
}

async function waitForFile(file: string): Promise<void> {
  if (fs.existsSync(file)) return;
  const signal = AbortSignal.timeout(2_000);
  try {
    for await (const event of fs.promises.watch(path.dirname(file), { signal })) {
      void event;
      if (fs.existsSync(file)) return;
    }
  } catch (error) {
    if (signal.aborted) throw new Error(`Timed out waiting for ${file}`);
    throw error;
  }
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('cloudflared lifecycle', () => {
  test.skipIf(!posixOnly)('starting records the public URL and reports the process alive', async () => {
    const { binary } = fakeCloudflared();
    const port = 39_101;
    const outcome = await startCloudflared(binary, writeConfig(CONFIG), 'kabmo.example.com', port);

    expect(outcome.ok).toBe(true);
    expect(outcome.url).toBe('https://kabmo.example.com');
    expect(runningTunnelUrl(port)).toBe('https://kabmo.example.com');
    expect(cloudflaredAlive(port)).toBe(true);

    stopCloudflared(port);
    expect(cloudflaredAlive(port)).toBe(false);
    expect(runningTunnelUrl(port)).toBeNull();
  });

  test.skipIf(!posixOnly)('runs a runtime copy pointed at this port, not the file on disk', async () => {
    const { binary, argsFile, configFile } = fakeCloudflared();
    const source = writeConfig(CONFIG);
    const port = 39_105;

    await startCloudflared(binary, source, 'kabmo.example.com', port);
    await waitForFile(argsFile);

    const args = fs.readFileSync(argsFile, 'utf8').trim().split('\n');
    expect(args.slice(0, 2)).toEqual(['tunnel', '--config']);
    const runtimePath = args[2];
    expect(args.slice(3)).toEqual(['run']);
    expect(args).not.toContain('--url');
    expect(runtimePath).not.toBe(source);
    expect(fs.existsSync(runtimePath)).toBe(true);

    const handed = fs.readFileSync(configFile, 'utf8');
    expect(handed).toContain(`service: http://127.0.0.1:${port}`);
    expect(handed).not.toContain('http://localhost:3000');
    expect(handed).toContain('credentials-file: /home/me/.cloudflared/6ff42ae2.json');
    // The user's file is never modified.
    expect(fs.readFileSync(source, 'utf8')).toBe(CONFIG);

    stopCloudflared(port);
    expect(fs.existsSync(path.dirname(runtimePath))).toBe(false);
  });

  test.skipIf(!posixOnly)('starting twice for one port reuses the running tunnel', async () => {
    const { binary } = fakeCloudflared();
    const config = writeConfig(CONFIG);
    const port = 39_102;
    await startCloudflared(binary, config, 'a.example.com', port);
    const second = await startCloudflared(binary, config, 'b.example.com', port);

    // The second call must not spawn a second process, and must not claim a
    // different hostname than the one actually running.
    expect(second.url).toBe('https://a.example.com');
    stopCloudflared(port);
  });

  test('a config with no ingress hostname is refused instead of spawned', async () => {
    const { binary } = fakeCloudflared();
    const outcome = await startCloudflared(
      binary,
      writeConfig('tunnel: t\ningress:\n  - service: http_status:404\n'),
      'x.example.com',
      39_106,
    );

    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toContain('no ingress rule');
    expect(cloudflaredAlive(39_106)).toBe(false);
  });

  test('stopping a tunnel that was never started is not an error', () => {
    expect(stopCloudflared(39_103)).toEqual({ ok: true, reason: null });
    expect(cloudflaredAlive(39_103)).toBe(false);
  });

  test('a binary that cannot be spawned reports the reason', async () => {
    const outcome = await startCloudflared('/nonexistent/cloudflared', writeConfig(CONFIG), 'x.example.com', 39_104);
    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toBeTruthy();
    expect(cloudflaredAlive(39_104)).toBe(false);
  });
});
