/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Everything the Connect page draws, assembled in one read.
 *
 * The page must never show a row it cannot explain. Every address carries either
 * a URL or a sentence saying why it is not usable, and every tunnel carries a
 * phase plus the reason it is not up — because "greyed out with no text" is the
 * failure mode this module exists to prevent.
 *
 * One fact is deliberately NOT here: which route a device is using right now.
 * The server cannot measure a phone's round trip, so that column is reported by
 * the device (`touchDevice`) and is a report, not an inference.
 */

import os from 'os';
import pkg from '@/../package.json';
import { connectIdentity } from '@/server/lib/connect/identity.server';
import { listPairedDevices } from '@/server/lib/connect/devices.server';
import {
  findTailscale,
  machineLabel,
  serveIsUp,
  tailscaleNode,
} from '@/server/lib/connect/tailscale.server';
import {
  cloudflaredAlive,
  findCloudflared,
  runningTunnelUrl,
} from '@/server/lib/connect/cloudflared.server';
import { resolveCloudflaredConfigPath } from '@/server/lib/connect/cloudflared-config.server';
import type {
  ConnectAddress,
  ConnectStatus,
  TunnelState,
} from '@/shared/lib/connect/types';

/** The port this process listens on. */
export function currentPort(): number {
  return Number(Bun.env.PORT) || 3000;
}

/** Whether the listener is reachable from another machine at all. */
function boundBeyondLoopback(): boolean {
  const host = (Bun.env.HOST ?? 'localhost').trim();
  return host === '0.0.0.0' || host === '::' || host === '';
}

/** Every non-internal IPv4 address, as origins on this port. */
function lanOrigins(port: number): string[] {
  const origins: string[] = [];
  try {
    for (const entries of Object.values(os.networkInterfaces())) {
      for (const entry of entries ?? []) {
        if (entry.family !== 'IPv4' || entry.internal) continue;
        origins.push(`http://${entry.address}:${port}`);
      }
    }
  } catch {
    // A host that cannot enumerate interfaces simply has no LAN address.
  }
  return origins;
}

async function tailscaleState(): Promise<{ tunnel: TunnelState; address: ConnectAddress | null }> {
  const presence = findTailscale();
  if (!presence.binary) {
    return {
      tunnel: { provider: 'tailscale', phase: 'failed', url: null, reason: presence.reason },
      address: { kind: 'tailscale', url: '', unavailable: presence.reason },
    };
  }

  const node = await tailscaleNode(presence.binary);
  if (!node) {
    const reason = 'The Tailscale daemon did not answer. Open Tailscale and sign in.';
    return {
      tunnel: { provider: 'tailscale', phase: 'failed', url: null, reason },
      address: { kind: 'tailscale', url: '', unavailable: reason },
    };
  }
  if (node.backendState !== 'Running') {
    const reason = `Tailscale is ${node.backendState.toLowerCase()}. Sign in to the tailnet first.`;
    return {
      tunnel: { provider: 'tailscale', phase: 'failed', url: null, reason },
      address: { kind: 'tailscale', url: '', unavailable: reason },
    };
  }
  if (!node.url) {
    const reason = 'This node has no MagicDNS name yet, so there is no HTTPS address to share.';
    return {
      tunnel: { provider: 'tailscale', phase: 'failed', url: null, reason },
      address: { kind: 'tailscale', url: '', unavailable: reason },
    };
  }

  const up = await serveIsUp(presence.binary);
  return {
    tunnel: {
      provider: 'tailscale',
      phase: up ? 'up' : 'off',
      url: up ? node.url : null,
      reason: up ? null : 'Serve is off. Turn it on to reach this server from your tailnet.',
    },
    address: {
      kind: 'tailscale',
      url: node.url,
      unavailable: up ? null : 'Serve is off, so this address does not answer yet.',
    },
  };
}

function cloudflareState(port: number, configPath: string): { tunnel: TunnelState; address: ConnectAddress | null } {
  const presence = findCloudflared(configPath);
  if (presence.reason || !presence.binary || !presence.configPath) {
    const reason = presence.reason ?? 'cloudflared is not configured.';
    return {
      tunnel: { provider: 'cloudflare', phase: 'failed', url: null, reason },
      address: { kind: 'cloudflare', url: '', unavailable: reason },
    };
  }

  const alive = cloudflaredAlive(port);
  const url = runningTunnelUrl(port);
  if (alive && url) {
    return {
      tunnel: { provider: 'cloudflare', phase: 'up', url, reason: null },
      address: { kind: 'cloudflare', url, unavailable: null },
    };
  }
  return {
    tunnel: {
      provider: 'cloudflare',
      phase: 'off',
      url: null,
      reason: 'The tunnel is not running. Cloudflare terminates TLS and can read the traffic.',
    },
    address: {
      kind: 'cloudflare',
      url: '',
      unavailable: 'The tunnel is not running.',
    },
  };
}

/** The whole page's payload. */
export async function connectStatus(): Promise<ConnectStatus> {
  const port = currentPort();
  const [tailscale, devices, configPath] = await Promise.all([
    tailscaleState(),
    listPairedDevices(),
    resolveCloudflaredConfigPath(),
  ]);
  const cloudflare = cloudflareState(port, configPath);

  const lanReachable = boundBeyondLoopback();
  const lan: ConnectAddress[] = lanOrigins(port).map((url) => ({
    kind: 'lan',
    url,
    unavailable: lanReachable
      ? null
      : 'This server listens on loopback only. Start it with --lan to answer on this address.',
  }));

  const addresses: ConnectAddress[] = [
    ...(tailscale.address ? [tailscale.address] : []),
    ...lan,
    ...(cloudflare.address ? [cloudflare.address] : []),
  ].filter((address) => address.url !== '' || address.unavailable !== null);

  return {
    serverId: connectIdentity().serverId,
    label: machineLabel(),
    version: pkg.version,
    addresses,
    tunnels: [tailscale.tunnel, cloudflare.tunnel],
    cloudflareConfigPath: configPath,
    devices,
  };
}
