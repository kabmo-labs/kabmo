/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Tailscale Serve, driven through the CLI the user already has.
 *
 * Serve is the preferred route for a reason that is not speed: it terminates TLS
 * on THIS machine with a certificate the platform already trusts, so every shell
 * accepts it without pinning, and the origin becomes a secure context — which is
 * what brings back `getUserMedia` (dictation), `navigator.clipboard.readText`,
 * `serviceWorker` and `crypto.subtle`. On the same network it is still a direct
 * WireGuard peer connection, so it costs a fraction of a millisecond over the
 * LAN address it replaces.
 *
 * Two facts about the CLI shape everything here:
 *
 * - `tailscale serve` proxies only to `http://127.0.0.1`, so Kabmo does NOT need
 *   `--lan` for this route. The listener stays on loopback.
 * - The macOS App Store and Standalone variants ship the CLI inside the app
 *   bundle rather than on PATH, so a `Bun.which` miss is not "not installed".
 */

import os from 'os';
import { run, which } from '@/server/lib/connect/run.server';

/** Where the macOS app variants keep the CLI when it is not on PATH. */
const MACOS_APP_CLI = '/Applications/Tailscale.app/Contents/MacOS/Tailscale';

/** The HTTPS port Serve listens on. 443 is the default and the one we use. */
export const TAILSCALE_HTTPS_PORT = 443;

export interface TailscalePresence {
  /** Absolute path to the CLI, or null when it cannot be found. */
  binary: string | null;
  /** Why it is absent, in one sentence, when it is. */
  reason: string | null;
}

export interface TailscaleNode {
  /** `https://<node>.<tailnet>.ts.net`, or null when the node has no name yet. */
  url: string | null;
  /** The node's own tailnet addresses, IPv4 first. */
  addresses: string[];
  /** `Running`, `Stopped`, `NeedsLogin`, … as the daemon reports it. */
  backendState: string;
}

/** Locate the CLI, including the macOS app bundle. */
export function findTailscale(): TailscalePresence {
  const onPath = which('tailscale');
  if (onPath) return { binary: onPath, reason: null };
  if (process.platform === 'darwin') {
    try {
      if (Bun.file(MACOS_APP_CLI).size > 0) return { binary: MACOS_APP_CLI, reason: null };
    } catch {
      // Not installed as an app either.
    }
  }
  return {
    binary: null,
    reason: 'The tailscale command was not found. Install Tailscale, or add its CLI to PATH.',
  };
}

interface StatusJson {
  BackendState?: unknown;
  Self?: {
    DNSName?: unknown;
    TailscaleIPs?: unknown;
  };
}

/**
 * The node's own identity, or null when the daemon cannot answer.
 *
 * `status --json` blocks against a stopped daemon, which is why the spawn has a
 * timeout: a settings page must render "not running" rather than hang.
 */
export async function tailscaleNode(binary: string): Promise<TailscaleNode | null> {
  const result = await run([binary, 'status', '--json'], { timeoutMs: 4_000 });
  if (!result.ok) return null;
  let parsed: StatusJson;
  try {
    parsed = JSON.parse(result.stdout) as StatusJson;
  } catch {
    return null;
  }

  const dnsName = typeof parsed.Self?.DNSName === 'string' ? parsed.Self.DNSName.replace(/\.$/, '') : '';
  const addresses = Array.isArray(parsed.Self?.TailscaleIPs)
    ? parsed.Self.TailscaleIPs.filter((value): value is string => typeof value === 'string')
    : [];
  return {
    url: dnsName ? `https://${dnsName}` : null,
    addresses,
    backendState: typeof parsed.BackendState === 'string' ? parsed.BackendState : 'Unknown',
  };
}

/** Whether Serve is currently sharing the HTTPS port. */
export async function serveIsUp(binary: string): Promise<boolean> {
  const result = await run([binary, 'serve', 'status', '--json'], { timeoutMs: 4_000 });
  if (!result.ok) return false;
  try {
    const parsed = JSON.parse(result.stdout) as Record<string, unknown>;
    // The shape is `{ TCP: { "443": { HTTPS: true } }, Web: {...} }`; a non-empty
    // object at either key means something is being served.
    const tcp = parsed.TCP;
    const web = parsed.Web;
    const hasTcp = typeof tcp === 'object' && tcp !== null && Object.keys(tcp).length > 0;
    const hasWeb = typeof web === 'object' && web !== null && Object.keys(web).length > 0;
    return hasTcp || hasWeb;
  } catch {
    return false;
  }
}

/**
 * Share `port` on the tailnet.
 *
 * `--bg` is what makes it survive a reboot and a `tailscale down`/`up`; without
 * it the share dies with the process that started it, which for a server that
 * restarts on update would mean the phone loses its route silently.
 */
export async function startServe(binary: string, port: number): Promise<{ ok: boolean; reason: string | null }> {
  const result = await run(
    [binary, 'serve', '--bg', '--yes', `--https=${TAILSCALE_HTTPS_PORT}`, `http://127.0.0.1:${port}`],
    { timeoutMs: 15_000 },
  );
  if (result.ok) return { ok: true, reason: null };
  if (result.error?.startsWith('timed out')) {
    return {
      ok: false,
      reason:
        'Tailscale did not answer within 15 seconds. HTTPS may be disabled for this tailnet — enable it in the Tailscale admin console, then try again.',
    };
  }
  const detail = (result.stderr || result.stdout || result.error || '').trim();
  return {
    ok: false,
    reason: detail
      ? `Tailscale refused: ${detail.split('\n')[0]}`
      : 'Tailscale refused to share this port. HTTPS may be disabled for the tailnet.',
  };
}

/**
 * Stop sharing the HTTPS port.
 *
 * `off` for the port we turned on, never `reset`: reset would also remove every
 * other share the user configured by hand, which is not ours to remove.
 */
export async function stopServe(binary: string): Promise<{ ok: boolean; reason: string | null }> {
  const result = await run(
    [binary, 'serve', '--yes', `--https=${TAILSCALE_HTTPS_PORT}`, 'off'],
    { timeoutMs: 10_000 },
  );
  if (result.ok) return { ok: true, reason: null };
  const detail = (result.stderr || result.stdout || result.error || '').trim();
  return { ok: false, reason: detail ? detail.split('\n')[0] : 'Tailscale did not stop the share.' };
}

/** The machine's display name, used as the server label in a pairing payload. */
export function machineLabel(): string {
  try {
    return os.hostname().replace(/\.local$/, '') || 'Kabmo';
  } catch {
    return 'Kabmo';
  }
}
