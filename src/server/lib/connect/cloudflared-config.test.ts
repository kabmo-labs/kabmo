/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The cloudflared config: the scan, the derived run copy, and the saved path.
 *
 * Three load-bearing claims. A config with an ingress block but no hostname is
 * "not configured", because reporting it would put a URL on the page that does
 * not resolve. The derived copy rewrites the FIRST hostname rule and only that
 * one — the catch-all 404 rule must stay, or cloudflared refuses to start. And a
 * saved path is written only after it names a runnable config, so the page never
 * shows a path the tunnel cannot use.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  cloudflaredConfigPath,
  deriveCloudflaredRunConfig,
  readCloudflaredConfig,
  resolveCloudflaredConfigPath,
  saveCloudflaredConfigPath,
} from '@/server/lib/connect/cloudflared-config.server';
import { isolateDb, releaseDb } from '@/test-support/isolated-db';

const dirs: string[] = [];

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kabmo-cf-'));
  dirs.push(dir);
  return dir;
}

function writeConfig(text: string): string {
  const file = path.join(tempDir(), 'config.yml');
  fs.writeFileSync(file, text);
  return file;
}

const VALID = [
  'tunnel: 6ff42ae2-765d-4adf-8112-31c55c1551ef',
  'credentials-file: /home/me/.cloudflared/6ff42ae2.json',
  '',
  'ingress:',
  '  - hostname: kabmo.example.com',
  '    service: http://localhost:3000',
  '  - service: http_status:404',
  '',
].join('\n');

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('readCloudflaredConfig', () => {
  test('reads the tunnel name and the first ingress hostname', () => {
    expect(readCloudflaredConfig(writeConfig(VALID))).toEqual({
      tunnel: '6ff42ae2-765d-4adf-8112-31c55c1551ef',
      hostname: 'kabmo.example.com',
    });
  });

  test('strips quotes around a value', () => {
    const file = writeConfig(['tunnel: "my-tunnel"', 'ingress:', '  - hostname: "a.example.com"'].join('\n'));
    expect(readCloudflaredConfig(file)).toEqual({ tunnel: 'my-tunnel', hostname: 'a.example.com' });
  });

  test('answers null for a file with neither field', () => {
    expect(readCloudflaredConfig(writeConfig('metrics: 127.0.0.1:20241\n'))).toBeNull();
  });

  test('answers null for a missing file', () => {
    expect(readCloudflaredConfig(path.join(os.tmpdir(), 'kabmo-does-not-exist.yml'))).toBeNull();
  });

  test('does not read a hostname from outside the ingress block', () => {
    const file = writeConfig(['tunnel: t', 'hostname: not-ingress.example.com', 'ingress:', '  - service: http_status:404'].join('\n'));
    expect(readCloudflaredConfig(file)).toEqual({ tunnel: 't', hostname: null });
  });
});

describe('deriveCloudflaredRunConfig', () => {
  test('rewrites the first hostname rule to this port and keeps the fallback rule', () => {
    const derived = deriveCloudflaredRunConfig(VALID, 5173);

    expect(derived).not.toBeNull();
    expect(derived).toContain('    service: http://127.0.0.1:5173');
    expect(derived).not.toContain('http://localhost:3000');
    expect(derived).toContain('  - service: http_status:404');
    expect(derived).toContain('credentials-file: /home/me/.cloudflared/6ff42ae2.json');
    expect(derived).toContain('tunnel: 6ff42ae2-765d-4adf-8112-31c55c1551ef');
  });

  test('adds a service to a hostname rule that has none', () => {
    const derived = deriveCloudflaredRunConfig(
      ['ingress:', '  - hostname: kabmo.example.com', '  - service: http_status:404'].join('\n'),
      4100,
    );

    expect(derived?.split('\n')).toEqual([
      'ingress:',
      '  - hostname: kabmo.example.com',
      '    service: http://127.0.0.1:4100',
      '  - service: http_status:404',
    ]);
  });

  test('skips a leading rule without a hostname', () => {
    const derived = deriveCloudflaredRunConfig(
      [
        'ingress:',
        '  - service: http_status:404',
        '  - hostname: a.example.com',
        '    service: http://localhost:1',
      ].join('\n'),
      4200,
    );

    expect(derived?.split('\n')[1]).toBe('  - service: http_status:404');
    expect(derived).toContain('    service: http://127.0.0.1:4200');
    expect(derived).not.toContain('http://localhost:1');
  });

  test('leaves an originRequest block under the rule intact', () => {
    const derived = deriveCloudflaredRunConfig(
      [
        'ingress:',
        '  - hostname: a.example.com',
        '    service: http://localhost:1',
        '    originRequest:',
        '      noTLSVerify: true',
        '  - service: http_status:404',
      ].join('\n'),
      4300,
    );

    expect(derived).toContain('      noTLSVerify: true');
  });

  test('does not mistake a nested list for the next ingress rule', () => {
    const derived = deriveCloudflaredRunConfig(
      [
        'ingress:',
        '  - hostname: a.example.com',
        '    originRequest:',
        '      ipRules:',
        '        - prefix: 10.0.0.0/8',
        '          ports: [80]',
        '    service: http://localhost:1',
        '  - service: http_status:404',
      ].join('\n'),
      4350,
    );

    expect(derived).toContain('    service: http://127.0.0.1:4350');
    expect(derived).not.toContain('http://localhost:1');
    expect(derived).toContain('        - prefix: 10.0.0.0/8');
  });

  test('answers null without an ingress block', () => {
    expect(deriveCloudflaredRunConfig('tunnel: t\n', 4400)).toBeNull();
  });

  test('answers null when the ingress block has no hostname', () => {
    expect(deriveCloudflaredRunConfig('ingress:\n  - service: http_status:404\n', 4500)).toBeNull();
  });
});

describe('the saved config path', () => {
  let previousEnv: string | undefined;

  beforeEach(async () => {
    previousEnv = Bun.env.CLOUDFLARED_CONFIG;
    await isolateDb();
  });

  afterEach(async () => {
    if (previousEnv === undefined) delete Bun.env.CLOUDFLARED_CONFIG;
    else Bun.env.CLOUDFLARED_CONFIG = previousEnv;
    await releaseDb();
  });

  test('falls back to CLOUDFLARED_CONFIG until a path is saved', async () => {
    const file = writeConfig(VALID);
    Bun.env.CLOUDFLARED_CONFIG = file;

    expect(cloudflaredConfigPath()).toBe(file);
    expect(await resolveCloudflaredConfigPath()).toBe(file);
  });

  test('a saved path wins over the environment', async () => {
    const file = writeConfig(VALID);
    Bun.env.CLOUDFLARED_CONFIG = path.join(os.tmpdir(), 'not-this-one.yml');

    const saved = await saveCloudflaredConfigPath(file);

    expect(saved).toEqual({ ok: true, path: path.resolve(file), reason: null });
    expect(await resolveCloudflaredConfigPath()).toBe(path.resolve(file));
  });

  test('an empty string clears the saved path', async () => {
    const file = writeConfig(VALID);
    Bun.env.CLOUDFLARED_CONFIG = file;
    await saveCloudflaredConfigPath(writeConfig(VALID));

    expect(await saveCloudflaredConfigPath('  ')).toEqual({ ok: true, path: file, reason: null });
    expect(await resolveCloudflaredConfigPath()).toBe(file);
  });

  test('refuses a relative path', async () => {
    expect(await saveCloudflaredConfigPath('config.yml')).toEqual({
      ok: false,
      path: null,
      reason: 'The config path must be absolute.',
    });
  });

  test('refuses a file that does not exist', async () => {
    const missing = path.join(os.tmpdir(), 'kabmo-no-config-here.yml');
    const outcome = await saveCloudflaredConfigPath(missing);

    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toContain(missing);
  });

  test('refuses a config without an ingress hostname', async () => {
    const file = writeConfig('tunnel: t\ningress:\n  - service: http_status:404\n');
    const outcome = await saveCloudflaredConfigPath(file);

    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toContain('no ingress hostname');
  });

  test('refuses a non-string path', async () => {
    expect(await saveCloudflaredConfigPath(42)).toEqual({
      ok: false,
      path: null,
      reason: 'Expected a config path.',
    });
  });
});
