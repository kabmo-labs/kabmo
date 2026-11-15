/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * `POST /api/connect/tunnels` — start or stop one provider.
 *
 * The response is the whole status payload rather than a boolean: the page has
 * to redraw the address list and the tunnel card together, and a second read
 * would let the two disagree for a frame.
 *
 * A refusal carries the provider's own sentence. "Tailscale refused: HTTPS is
 * not enabled for this tailnet" is actionable; `{ ok: false }` is not.
 */

import { json, NO_STORE_HEADERS, type ActionFunctionArgs } from '@/server/lib/remix-compat';
import { connectStatus, currentPort } from '@/server/lib/connect/status.server';
import { findTailscale, startServe, stopServe } from '@/server/lib/connect/tailscale.server';
import {
  findCloudflared,
  readCloudflaredConfig,
  startCloudflared,
  stopCloudflared,
} from '@/server/lib/connect/cloudflared.server';

interface TunnelRequest {
  provider?: unknown;
  action?: unknown;
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, { status: 405, headers: NO_STORE_HEADERS });
  }

  const body = (await request.json().catch(() => null)) as TunnelRequest | null;
  const provider = body?.provider;
  const verb = body?.action;
  if ((provider !== 'tailscale' && provider !== 'cloudflare') || (verb !== 'start' && verb !== 'stop')) {
    return json(
      { error: 'Expected { provider: "tailscale" | "cloudflare", action: "start" | "stop" }' },
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
  } else {
    const presence = findCloudflared();
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
