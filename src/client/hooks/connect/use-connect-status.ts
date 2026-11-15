/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The Connect page's one read, and the three actions that change it.
 *
 * Every action answers with the WHOLE status payload rather than a boolean, so
 * the address list and the tunnel card are redrawn from one snapshot. A second
 * read after a toggle would let the two disagree for a frame — the card saying
 * "up" while the address row still says "not running".
 *
 * A refusal is returned as a sentence, never swallowed: the server's own words
 * ("Tailscale refused: HTTPS is not enabled for this tailnet") are the only
 * place the user learns what to fix.
 */

import { useCallback, useEffect, useState } from 'preact/hooks';
import type { ConnectStatus } from '@/shared/lib/connect/types';

export type TunnelProvider = 'cloudflare' | 'tailscale';
export type TunnelVerb = 'start' | 'stop';

export interface UseConnectStatusResult {
  status: ConnectStatus | null;
  /** Why the last read or action failed, in the server's words. */
  error: string | null;
  /** Which control is in flight, so only that one is disabled. */
  busy: string | null;
  refresh: () => Promise<void>;
  setTunnel: (provider: TunnelProvider, verb: TunnelVerb) => Promise<string | null>;
  setCloudflareConfig: (path: string) => Promise<string | null>;
  revoke: (id: string) => Promise<string | null>;
}

interface StatusEnvelope {
  status?: ConnectStatus;
  error?: string;
}

interface PostOutcome {
  payload: StatusEnvelope | null;
  message: string | null;
}

async function postTunnel(body: Record<string, unknown>): Promise<PostOutcome> {
  try {
    const response = await fetch('/api/connect/tunnels', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const payload = (await response.json().catch(() => null)) as StatusEnvelope | null;
    if (!response.ok) {
      return {
        payload,
        message: payload?.error ?? `The tunnel did not change (HTTP ${response.status}).`,
      };
    }
    return { payload, message: null };
  } catch (cause) {
    return {
      payload: null,
      message: cause instanceof Error ? cause.message : 'The tunnel did not change.',
    };
  }
}

export function useConnectStatus(): UseConnectStatusResult {
  const [status, setStatus] = useState<ConnectStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/connect/status', { headers: { accept: 'application/json' } });
      if (!response.ok) {
        setError(`Could not read the connection state (HTTP ${response.status}).`);
        return;
      }
      setStatus((await response.json()) as ConnectStatus);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not read the connection state.');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const applyTunnel = useCallback(
    async (busyKey: string, body: Record<string, unknown>): Promise<string | null> => {
      setBusy(busyKey);
      try {
        const { payload, message } = await postTunnel(body);
        if (payload?.status) setStatus(payload.status);
        setError(message);
        return message;
      } finally {
        setBusy(null);
      }
    },
    [],
  );

  const setTunnel = useCallback(
    (provider: TunnelProvider, verb: TunnelVerb) => applyTunnel(`${provider}:${verb}`, { provider, action: verb }),
    [applyTunnel],
  );

  const setCloudflareConfig = useCallback(
    (path: string) => applyTunnel('cloudflare:config', { provider: 'cloudflare', action: 'config', path }),
    [applyTunnel],
  );

  const revoke = useCallback(async (id: string): Promise<string | null> => {
    setBusy(`device:${id}`);
    try {
      const response = await fetch(`/api/connect/devices?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      const payload = (await response.json().catch(() => null)) as { devices?: ConnectStatus['devices']; error?: string } | null;
      if (!response.ok) {
        const message = payload?.error ?? `Could not revoke that device (HTTP ${response.status}).`;
        setError(message);
        return message;
      }
      setStatus((current) => (current && payload?.devices ? { ...current, devices: payload.devices } : current));
      setError(null);
      return null;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Could not revoke that device.';
      setError(message);
      return message;
    } finally {
      setBusy(null);
    }
  }, []);

  return { status, error, busy, refresh, setTunnel, setCloudflareConfig, revoke };
}
