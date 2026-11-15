/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Cloudflare Tunnel, named only.
 *
 * Quick tunnels are deliberately NOT supported. Two measured facts make them
 * unusable for this product: they buffer Server-Sent Events (cloudflared #1449 —
 * the maintainer confirms named tunnels stream correctly and quick tunnels do
 * not), and Kabmo has six SSE endpoints including the chat stream, so a quick
 * tunnel would make every answer arrive in one burst at the end. They also cap
 * at 200 in-flight requests and change hostname on every start.
 *
 * A named tunnel needs an account and a domain, which is why it is the second
 * route rather than the first. It is also the one route where a third party
 * reads the traffic: TLS terminates at Cloudflare's edge, so the console's
 * password and every prompt cross their machines in plaintext. The Connect page
 * says so on the card rather than in a wiki.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  deriveCloudflaredRunConfig,
  readCloudflaredConfig,
} from '@/server/lib/connect/cloudflared-config.server';
import { which } from '@/server/lib/connect/run.server';

export interface CloudflaredPresence {
  binary: string | null;
  configPath: string | null;
  /** Why it cannot be used, in one sentence, when it cannot. */
  reason: string | null;
}

/** Locate the binary and read the config at `configPath`. */
export function findCloudflared(configPath: string): CloudflaredPresence {
  const binary = which('cloudflared');
  if (!binary) {
    return {
      binary: null,
      configPath: null,
      reason: 'The cloudflared command was not found. Install it with `brew install cloudflared`.',
    };
  }
  const config = readCloudflaredConfig(configPath);
  if (!config) {
    return {
      binary,
      configPath: null,
      reason: `No cloudflared config at ${configPath}. A named tunnel needs an account and a domain.`,
    };
  }
  if (!config.hostname) {
    return {
      binary,
      configPath,
      reason: `The config at ${configPath} has no ingress hostname, so there is no public URL to show.`,
    };
  }
  return { binary, configPath, reason: null };
}

interface RunningTunnel {
  proc: Bun.Subprocess<'ignore', 'ignore', 'pipe'>;
  url: string;
  /** The temporary directory holding the derived config. */
  runtimeDir: string;
}

declare global {
  // eslint-disable-next-line no-var
  var __kabmoCloudflared: Map<number, RunningTunnel> | undefined;
}

function running(): Map<number, RunningTunnel> {
  globalThis.__kabmoCloudflared ??= new Map();
  return globalThis.__kabmoCloudflared;
}

function removeRuntimeDir(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // A directory the process cannot remove is not worth failing a stop over.
  }
}

/** The public origin of a running tunnel for `port`, or null. */
export function runningTunnelUrl(port: number): string | null {
  return running().get(port)?.url ?? null;
}

/**
 * Start the named tunnel for `port`.
 *
 * cloudflared runs a copy of the config whose ingress `service:` is this
 * instance's port — see `deriveCloudflaredRunConfig` for why `--url` cannot do
 * that job. The copy is deleted when the process exits or is stopped.
 */
export async function startCloudflared(
  binary: string,
  configPath: string,
  hostname: string,
  port: number,
): Promise<{ ok: boolean; url: string | null; reason: string | null }> {
  if (running().has(port)) {
    return { ok: true, url: runningTunnelUrl(port), reason: null };
  }

  let text: string;
  try {
    text = fs.readFileSync(configPath, 'utf8');
  } catch {
    return { ok: false, url: null, reason: `Could not read the cloudflared config at ${configPath}.` };
  }
  const derived = deriveCloudflaredRunConfig(text, port);
  if (!derived) {
    return {
      ok: false,
      url: null,
      reason: `The config at ${configPath} has no ingress rule with a hostname to point at port ${port}.`,
    };
  }

  let runtimeDir: string;
  let runConfigPath: string;
  try {
    runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kabmo-cloudflared-'));
    runConfigPath = path.join(runtimeDir, 'config.yml');
    fs.writeFileSync(runConfigPath, derived, { mode: 0o600 });
  } catch (error) {
    return {
      ok: false,
      url: null,
      reason: error instanceof Error ? error.message : String(error),
    };
  }

  let proc: Bun.Subprocess<'ignore', 'ignore', 'pipe'>;
  try {
    proc = Bun.spawn({
      cmd: [binary, 'tunnel', '--config', runConfigPath, 'run'],
      stdin: 'ignore',
      stdout: 'ignore',
      stderr: 'pipe',
      env: { ...Bun.env },
    });
  } catch (error) {
    removeRuntimeDir(runtimeDir);
    return {
      ok: false,
      url: null,
      reason: error instanceof Error ? error.message : String(error),
    };
  }

  const url = `https://${hostname}`;
  running().set(port, { proc, url, runtimeDir });

  // The process is long-lived; a failure after this point is reported by the
  // status read (the process is gone), not by this call.
  proc.exited.then(() => {
    running().delete(port);
    removeRuntimeDir(runtimeDir);
  });

  return { ok: true, url, reason: null };
}

/** Stop the tunnel for `port`, if this process started one. */
export function stopCloudflared(port: number): { ok: boolean; reason: string | null } {
  const entry = running().get(port);
  if (!entry) return { ok: true, reason: null };
  try {
    entry.proc.kill('SIGTERM');
  } catch {
    // Already gone.
  }
  running().delete(port);
  removeRuntimeDir(entry.runtimeDir);
  return { ok: true, reason: null };
}

/** Whether a tunnel this process started is still alive. */
export function cloudflaredAlive(port: number): boolean {
  const entry = running().get(port);
  if (!entry) return false;
  return entry.proc.exitCode === null;
}
