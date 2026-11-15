/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The Tailscale CLI, driven through a stand-in.
 *
 * The real daemon cannot be scripted: `serve` needs HTTPS enabled for the tailnet
 * and a signed-in node, so the happy path is unreachable on a machine that has
 * neither. A fake binary that answers the same JSON is what makes the parsing,
 * the URL derivation and the stop path testable at all — and those are the parts
 * that break silently, because a wrong field name reads as "not running" rather
 * than as an error.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { serveIsUp, startServe, stopServe, tailscaleNode } from '@/server/lib/connect/tailscale.server';

const dirs: string[] = [];

function fakeTailscale(script: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kabmo-ts-'));
  dirs.push(dir);
  const file = path.join(dir, 'tailscale');
  fs.writeFileSync(file, `#!/bin/sh\n${script}\n`);
  fs.chmodSync(file, 0o755);
  return file;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const RUNNING = `cat <<'JSON'
{"BackendState":"Running","Self":{"DNSName":"node.tailnet.ts.net.","TailscaleIPs":["100.1.2.3","fd7a::1"]}}
JSON`;

describe('tailscaleNode', () => {
  test('derives the https origin from the MagicDNS name', async () => {
    const binary = fakeTailscale(RUNNING);
    const node = await tailscaleNode(binary);
    expect(node?.url).toBe('https://node.tailnet.ts.net');
    expect(node?.addresses).toEqual(['100.1.2.3', 'fd7a::1']);
    expect(node?.backendState).toBe('Running');
  });

  test('answers null when the daemon does not answer', async () => {
    const binary = fakeTailscale('exit 1');
    expect(await tailscaleNode(binary)).toBeNull();
  });

  test('answers null for output that is not JSON', async () => {
    const binary = fakeTailscale('echo "not json"');
    expect(await tailscaleNode(binary)).toBeNull();
  });

  test('reports a node that is not signed in', async () => {
    const binary = fakeTailscale(`echo '{"BackendState":"NeedsLogin","Self":{}}'`);
    const node = await tailscaleNode(binary);
    expect(node?.backendState).toBe('NeedsLogin');
    expect(node?.url).toBeNull();
  });
});

describe('serveIsUp', () => {
  test('reads a TCP share as up', async () => {
    const binary = fakeTailscale(`echo '{"TCP":{"443":{"HTTPS":true}}}'`);
    expect(await serveIsUp(binary)).toBe(true);
  });

  test('reads an empty config as down', async () => {
    const binary = fakeTailscale(`echo '{}'`);
    expect(await serveIsUp(binary)).toBe(false);
  });

  test('reads a failing command as down', async () => {
    const binary = fakeTailscale('exit 1');
    expect(await serveIsUp(binary)).toBe(false);
  });
});

describe('startServe / stopServe', () => {
  test('a successful share reports no reason', async () => {
    const binary = fakeTailscale('exit 0');
    expect(await startServe(binary, 3000)).toEqual({ ok: true, reason: null });
  });

  test('a refusal carries the CLI sentence', async () => {
    const binary = fakeTailscale('echo "HTTPS is not enabled for this tailnet" >&2; exit 1');
    const outcome = await startServe(binary, 3000);
    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toContain('HTTPS is not enabled');
  });

  test('a silent timeout names the likely cause instead of the timeout', async () => {
    // The real CLI blocks when HTTPS is off, and "timed out" alone tells the user
    // nothing they can act on.
    const binary = fakeTailscale('sleep 30');
    const outcome = await startServe(binary, 3000);
    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toContain('HTTPS may be disabled');
  }, 30_000);

  test('stopping a share that is not there still succeeds', async () => {
    const binary = fakeTailscale('exit 0');
    expect(await stopServe(binary)).toEqual({ ok: true, reason: null });
  });
});
