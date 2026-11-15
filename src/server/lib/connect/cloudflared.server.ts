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
import { which } from '@/server/lib/connect/run.server';

export interface CloudflaredPresence {
  binary: string | null;
  configPath: string | null;
  /** Why it cannot be used, in one sentence, when it cannot. */
  reason: string | null;
}

export interface CloudflaredConfig {
  /** The tunnel name or UUID from `tunnel:`. */
  tunnel: string | null;
  /** The first public hostname in the ingress list. */
  hostname: string | null;
}

/** Where cloudflared looks for its config, honouring the documented override. */
export function cloudflaredConfigPath(): string {
  const override = (Bun.env.CLOUDFLARED_CONFIG ?? '').trim();
  if (override) return override;
  return path.join(os.homedir(), '.cloudflared', 'config.yml');
}

/**
 * Read the two facts this page needs out of the YAML.
 *
 * A line scan rather than a YAML parser: the file is written by
 * `cloudflared tunnel create` and by hand, and the only fields read here are a
 * top-level `tunnel:` and the first `hostname:` under `ingress:`. Pulling in a
 * parser for two scalars would be a dependency the rest of the server does not
 * have, and a malformed file must degrade to "not configured" rather than throw.
 */
export function readCloudflaredConfig(file: string): CloudflaredConfig | null {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }

  let tunnel: string | null = null;
  let hostname: string | null = null;
  let inIngress = false;
  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/\s+#.*$/, '');
    if (/^tunnel:\s*/.test(line)) {
      tunnel = line.replace(/^tunnel:\s*/, '').trim().replace(/^["']|["']$/g, '') || null;
      continue;
    }
    if (/^ingress:\s*$/.test(line)) {
      inIngress = true;
      continue;
    }
    if (inIngress && /^\S/.test(line)) {
      // A new top-level key ends the ingress block.
      inIngress = false;
    }
    if (inIngress && hostname === null) {
      const match = /^\s*-\s*hostname:\s*(\S+)/.exec(line) ?? /^\s*hostname:\s*(\S+)/.exec(line);
      if (match?.[1]) hostname = match[1].replace(/^["']|["']$/g, '');
    }
  }

  if (!tunnel && !hostname) return null;
  return { tunnel, hostname };
}

/** Locate the binary and a usable config. */
export function findCloudflared(): CloudflaredPresence {
  const binary = which('cloudflared');
  const configPath = cloudflaredConfigPath();
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
}

declare global {
  // eslint-disable-next-line no-var
  var __kabmoCloudflared: Map<number, RunningTunnel> | undefined;
}

function running(): Map<number, RunningTunnel> {
  globalThis.__kabmoCloudflared ??= new Map();
  return globalThis.__kabmoCloudflared;
}

/** The public origin of a running tunnel for `port`, or null. */
export function runningTunnelUrl(port: number): string | null {
  return running().get(port)?.url ?? null;
}

/**
 * Start the named tunnel for `port`.
 *
 * `--url` overrides the config's ingress service so the tunnel points at THIS
 * instance's port rather than whatever the config was written for; without it a
 * second Kabmo on another port would silently share the first one.
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

  let proc: Bun.Subprocess<'ignore', 'ignore', 'pipe'>;
  try {
    proc = Bun.spawn({
      cmd: [binary, 'tunnel', '--config', configPath, 'run', '--url', `http://127.0.0.1:${port}`],
      stdin: 'ignore',
      stdout: 'ignore',
      stderr: 'pipe',
      env: { ...Bun.env },
    });
  } catch (error) {
    return {
      ok: false,
      url: null,
      reason: error instanceof Error ? error.message : String(error),
    };
  }

  const url = `https://${hostname}`;
  running().set(port, { proc, url });

  // The process is long-lived; a failure after this point is reported by the
  // status read (the process is gone), not by this call.
  proc.exited.then(() => {
    running().delete(port);
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
  return { ok: true, reason: null };
}

/** Whether a tunnel this process started is still alive. */
export function cloudflaredAlive(port: number): boolean {
  const entry = running().get(port);
  if (!entry) return false;
  return entry.proc.exitCode === null;
}
