/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The MCP servers the open session has, the switch that changes them for that
 * session only, and the on-demand connection probe behind the status icon.
 *
 * The list is read from the server, not derived in the browser: the merge
 * (user file, project file, app-local rows, plugins) and the session's own
 * overrides live in one place, and a second derivation here would drift from
 * what the spawn path actually delivered.
 *
 * A toggle is optimistic only in the sense that the response carries the new
 * list: the server answers with the state it persisted, so a refused write
 * leaves the checkbox where it was instead of showing a change that did not
 * happen. A probe is explicit — it starts a second instance of the server — so
 * it runs when the info control is pressed, never on mount.
 */

import { useCallback, useEffect, useState } from 'preact/hooks';
import type { McpProbeResult, SessionMcpPayload, SessionMcpServer } from '@/shared/types';

export interface SessionMcpState {
  servers: SessionMcpServer[];
  delivery: SessionMcpPayload['delivery'];
  live: boolean;
  loading: boolean;
  error: string | null;
  /** The server name whose toggle is in flight, if any. */
  pending: string | null;
  /** The server name whose handshake is in flight, if any. */
  checking: string | null;
  toggle: (name: string, enabled: boolean) => Promise<void>;
  probe: (name: string) => Promise<void>;
}

export function useSessionMcp(sessionId: string | null): SessionMcpState {
  const [payload, setPayload] = useState<SessionMcpPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [checking, setChecking] = useState<string | null>(null);

  useEffect(() => {
    // Dropped on a session change so the previous chat's servers cannot be
    // drawn under the new title while the read is in flight.
    setPayload(null);
    setError(null);
    if (!sessionId) return;
    let cancelled = false;
    setLoading(true);
    fetch(`/api/sessions/${encodeURIComponent(sessionId)}/mcp`)
      .then(async (response) => {
        const data: unknown = await response.json().catch(() => null);
        if (!response.ok) {
          const message = data && typeof data === 'object' && 'error' in data ? String(data.error) : `HTTP ${response.status}`;
          throw new Error(message);
        }
        return data as SessionMcpPayload;
      })
      .then((data) => {
        if (!cancelled) setPayload(data);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const toggle = useCallback(
    async (name: string, enabled: boolean) => {
      if (!sessionId) return;
      setPending(name);
      setError(null);
      try {
        const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/mcp`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, enabled }),
        });
        const data: unknown = await response.json().catch(() => null);
        if (!response.ok) {
          const message = data && typeof data === 'object' && 'error' in data ? String(data.error) : `HTTP ${response.status}`;
          throw new Error(message);
        }
        const next = data as { servers?: SessionMcpServer[]; overrides?: Record<string, boolean> };
        setPayload((previous) =>
          previous
            ? {
                ...previous,
                servers: next.servers ?? previous.servers,
                overrides: next.overrides ?? previous.overrides,
              }
            : previous,
        );
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setPending(null);
      }
    },
    [sessionId],
  );

  const probe = useCallback(
    async (name: string) => {
      if (!sessionId) return;
      setChecking(name);
      setError(null);
      try {
        const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/mcp/probe`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name }),
        });
        const data: unknown = await response.json().catch(() => null);
        if (!response.ok) {
          const message = data && typeof data === 'object' && 'error' in data ? String(data.error) : `HTTP ${response.status}`;
          throw new Error(message);
        }
        const result = data as McpProbeResult;
        setPayload((previous) =>
          previous
            ? {
                ...previous,
                servers: previous.servers.map((server) =>
                  server.name === name ? { ...server, probe: result } : server,
                ),
              }
            : previous,
        );
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setChecking(null);
      }
    },
    [sessionId],
  );

  return {
    servers: payload?.servers ?? [],
    delivery: payload?.delivery ?? null,
    live: payload?.live ?? false,
    loading,
    error,
    pending,
    checking,
    toggle,
    probe,
  };
}
