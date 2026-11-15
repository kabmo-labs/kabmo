/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The cloudflared config scan.
 *
 * A line scan is only safe if it refuses the shapes it cannot read. The case
 * that matters is a config with an ingress block but no hostname: reporting a
 * tunnel as configured there would put a URL on the page that does not exist.
 */

import { describe, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { readCloudflaredConfig } from '@/server/lib/connect/cloudflared.server';

function writeConfig(text: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kabmo-cf-'));
  const file = path.join(dir, 'config.yml');
  fs.writeFileSync(file, text);
  return file;
}

describe('readCloudflaredConfig', () => {
  test('reads the tunnel name and the first ingress hostname', () => {
    const file = writeConfig(
      [
        'tunnel: 6ff42ae2-765d-4adf-8112-31c55c1551ef',
        'credentials-file: /home/me/.cloudflared/6ff42ae2.json',
        '',
        'ingress:',
        '  - hostname: kabmo.example.com',
        '    service: http://localhost:3000',
        '  - service: http_status:404',
        '',
      ].join('\n'),
    );
    expect(readCloudflaredConfig(file)).toEqual({
      tunnel: '6ff42ae2-765d-4adf-8112-31c55c1551ef',
      hostname: 'kabmo.example.com',
    });
  });

  test('strips quotes around a value', () => {
    const file = writeConfig(['tunnel: "my-tunnel"', 'ingress:', '  - hostname: "a.example.com"'].join('\n'));
    expect(readCloudflaredConfig(file)).toEqual({ tunnel: 'my-tunnel', hostname: 'a.example.com' });
  });

  test('answers null for a file with neither field', () => {
    const file = writeConfig('metrics: 127.0.0.1:20241\n');
    expect(readCloudflaredConfig(file)).toBeNull();
  });

  test('answers null for a missing file', () => {
    expect(readCloudflaredConfig(path.join(os.tmpdir(), 'kabmo-does-not-exist.yml'))).toBeNull();
  });

  test('does not read a hostname from outside the ingress block', () => {
    const file = writeConfig(['tunnel: t', 'hostname: not-ingress.example.com', 'ingress:', '  - service: http_status:404'].join('\n'));
    expect(readCloudflaredConfig(file)).toEqual({ tunnel: 't', hostname: null });
  });
});
