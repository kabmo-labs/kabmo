/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Live connection status of the realtime channel.
 *
 * One socket serves every feature now, so this reports that socket rather than
 * an agent-stream transport: the `transport` field and its SSE fallback are
 * gone with the per-session streams they described, and the navbar dot is
 * green exactly while the shared channel is attached.
 *
 * The status lives in `@/shared/lib/realtime/client` (it owns the socket) and
 * is surfaced here as a hook so the navbar, which sits in a sibling subtree
 * from the timeline, reads the same value every other consumer does.
 */

import { useEffect, useState } from 'preact/hooks';
import { realtimeClient, type RealtimeStatus } from '@/shared/lib/realtime/client';

export interface AgentStreamStatus {
  /** The channel is attached and frames may arrive. */
  connected: boolean;
  /** The transport's own state, for a surface that wants to name it. */
  status: RealtimeStatus;
}

function snapshot(): AgentStreamStatus {
  const status = realtimeClient.status();
  return { connected: status === 'open', status };
}

/** Observe the realtime channel's connection state. */
export function useAgentStreamStatus(): AgentStreamStatus {
  const [value, setValue] = useState<AgentStreamStatus>(snapshot);
  useEffect(() => {
    setValue(snapshot());
    return realtimeClient.onStatus(() => setValue(snapshot()));
  }, []);
  return value;
}
