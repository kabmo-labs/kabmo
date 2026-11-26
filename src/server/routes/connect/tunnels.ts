/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * `POST /api/connect/tunnels` — start or stop one provider, or point the
 * Cloudflare row at a different config file.
 *
 * The response is the whole status payload rather than a boolean: the page has
 * to redraw the address list, the tunnel card and the config path together, and
 * a second read would let the two disagree for a frame.
 *
 * A refusal carries the provider's own sentence. "Tailscale refused: HTTPS is
 * not enabled for this tailnet" is actionable; `{ ok: false }` is not.
 */

import { json, NO_STORE_HEADERS, type ActionFunctionArgs } from '@kabmo-labs/kabmo-http';
import { connectStatus, currentPort } from '@/server/lib/connect/status.server';
import { findTailscale, startServe, stopServe } from '@/server/lib/connect/tailscale.server';
import {
  cloudflaredAlive,
  findCloudflared,
  startCloudflared,
  stopCloudflared,
} from '@/server/lib/connect/cloudflared.server';
import {
  readCloudflaredConfig,
  resolveCloudflaredConfigPath,
  saveCloudflaredConfigPath,
} from '@/server/lib/connect/cloudflared-config.server';

interface TunnelRequest {
  provider?: unknown;
  action?: unknown;
  path?: unknown;
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, { status: 405, headers: NO_STORE_HEADERS });
  }

  const body = (await request.json().catch(() => null)) as TunnelRequest | null;
  const provider = body?.provider;
  const verb = body?.action;
  const knownVerb = verb === 'start' || verb === 'stop' || verb === 'config';
  if ((provider !== 'tailscale' && provider !== 'cloudflare') || !knownVerb) {
    return json(
      { error: 'Expected { provider: "tailscale" | "cloudflare", action: "start" | "stop" | "config" }' },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }
  if (verb === 'config' && provider !== 'cloudflare') {
    return json(
      { error: 'Only the Cloudflare tunnel takes a config path.' },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  const port = currentPort();
  let failure: string | null = null;

  if (provider === 'tailscale') {
    const presence = findTailscale();
    if (!presence.binary) {
      failure = presence.reason;
    } else {
      const outcome = verb === 'start' ? await startServe(presence.binary, port) : await stopServe(presence.binary);
      if (!outcome.ok) failure = outcome.reason;
    }
  } else if (verb === 'stop') {
    stopCloudflared(port);
  } else if (verb === 'config') {
    const before = await resolveCloudflaredConfigPath();
    const saved = await saveCloudflaredConfigPath(body?.path);
    if (!saved.ok) {
      failure = saved.reason;
    } else if (saved.path !== before && cloudflaredAlive(port)) {
      // The running process holds the old file; leaving it up would make the
      // page name a path the tunnel is not using.
      stopCloudflared(port);
    }
  } else {
    const configPath = await resolveCloudflaredConfigPath();
    const presence = findCloudflared(configPath);
    const config = presence.configPath ? readCloudflaredConfig(presence.configPath) : null;
    if (presence.reason || !presence.binary || !presence.configPath || !config?.hostname) {
      failure = presence.reason ?? 'cloudflared is not configured.';
    } else {
      const outcome = await startCloudflared(presence.binary, presence.configPath, config.hostname, port);
      if (!outcome.ok) failure = outcome.reason;
    }
  }

  const status = await connectStatus();
  return json(
    failure ? { ok: false, error: failure, status } : { ok: true, status },
    { status: failure ? 400 : 200, headers: NO_STORE_HEADERS },
  );
}
