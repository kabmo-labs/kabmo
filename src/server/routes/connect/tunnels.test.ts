/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The tunnels route's config action.
 *
 * The page sends a path, not a flag, because the server owns the "is this a
 * runnable config?" question. The cases pin that contract: a missing file and a
 * hostname-less file are refused with the reason, a good path is persisted and
 * reported back in the same payload, and a running tunnel is stopped when the
 * file underneath it changes — leaving it up would label the page with a path
 * the process is not using.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { action } from '@/server/routes/connect/tunnels';
import {
  cloudflaredAlive,
  runningTunnelUrl,
  startCloudflared,
} from '@/server/lib/connect/cloudflared.server';
import type { ConnectStatus } from '@/shared/lib/connect/types';
import { isolateDb, releaseDb } from '@/test-support/isolated-db';

const dirs: string[] = [];

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kabmo-cf-route-'));
  dirs.push(dir);
  return dir;
}

function writeConfig(): string {
  const file = path.join(tempDir(), 'config.yml');
  fs.writeFileSync(
    file,
    ['tunnel: t', 'ingress:', '  - hostname: kabmo.example.com', '    service: http://localhost:3000', '  - service: http_status:404', ''].join('\n'),
  );
  return file;
}

async function post(body: unknown) {
  const request = new Request('http://localhost/api/connect/tunnels', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const response = await action({ request } as never);
  return {
    status: response.status,
    body: (await response.json()) as { ok?: boolean; error?: string; status?: ConnectStatus },
  };
}

let previousConfig: string | undefined;
let previousDataDir: string | undefined;

beforeEach(async () => {
  previousConfig = Bun.env.CLOUDFLARED_CONFIG;
  previousDataDir = Bun.env.KABMO_DATA_DIR;
  Bun.env.KABMO_DATA_DIR = tempDir();
  await isolateDb();
});

afterEach(async () => {
  if (previousConfig === undefined) delete Bun.env.CLOUDFLARED_CONFIG;
  else Bun.env.CLOUDFLARED_CONFIG = previousConfig;
  if (previousDataDir === undefined) delete Bun.env.KABMO_DATA_DIR;
  else Bun.env.KABMO_DATA_DIR = previousDataDir;
  await releaseDb();
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('POST /api/connect/tunnels config action', () => {
  test('persists a runnable config path and reports it in the payload', async () => {
    const file = writeConfig();
    const { status, body } = await post({ provider: 'cloudflare', action: 'config', path: file });

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.status?.cloudflareConfigPath).toBe(path.resolve(file));
  });

  test('refuses a config that does not exist', async () => {
    const missing = path.join(tempDir(), 'nope.yml');
    const { status, body } = await post({ provider: 'cloudflare', action: 'config', path: missing });

    expect(status).toBe(400);
    expect(body.error).toContain(missing);
    expect(body.status).toBeDefined();
  });

  test('refuses a config with no ingress hostname', async () => {
    const file = path.join(tempDir(), 'config.yml');
    fs.writeFileSync(file, 'tunnel: t\ningress:\n  - service: http_status:404\n');
    const { status, body } = await post({ provider: 'cloudflare', action: 'config', path: file });

    expect(status).toBe(400);
    expect(body.error).toContain('no ingress hostname');
  });

  test('refuses a config path for tailscale', async () => {
    const { status, body } = await post({ provider: 'tailscale', action: 'config', path: writeConfig() });

    expect(status).toBe(400);
    expect(body.error).toBe('Only the Cloudflare tunnel takes a config path.');
  });

  test('refuses an unknown action', async () => {
    const { status, body } = await post({ provider: 'cloudflare', action: 'restart' });

    expect(status).toBe(400);
    expect(body.error).toContain('Expected');
  });

  test.skipIf(process.platform === 'win32')('stops a running tunnel when the config path changes', async () => {
    const first = writeConfig();
    Bun.env.CLOUDFLARED_CONFIG = first;

    const dir = tempDir();
    const binary = path.join(dir, 'cloudflared');
    fs.writeFileSync(binary, '#!/bin/sh\nexec sleep 30\n');
    fs.chmodSync(binary, 0o755);

    const port = Number(Bun.env.PORT) || 3000;
    const started = await startCloudflared(binary, first, 'kabmo.example.com', port);
    expect(started.ok).toBe(true);
    expect(cloudflaredAlive(port)).toBe(true);

    const { status } = await post({ provider: 'cloudflare', action: 'config', path: writeConfig() });

    expect(status).toBe(200);
    expect(cloudflaredAlive(port)).toBe(false);
    expect(runningTunnelUrl(port)).toBeNull();
  });
});
