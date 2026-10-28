/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Peer bridging for a session topic: relaying a session's frames from the
 * Kabmo instances that OWNS it into this instance's hub.
 *
 * Both instances share a database and an agent dir, so the owner's stream IS
 * this session's stream, and the client stays on whichever instance it opened
 * instead of being sent to another port.
 *
 * The relay dials the owner's UNIFIED realtime socket and subscribes this
 * session's topic on it. That is the only wire that carries a session's frames
 * now: the per-session agent socket (`/api/agent/<id>/ws`) was deleted with the
 * realtime migration, so a relay aimed at it reached a 404 and no frame ever
 * arrived — while the topic's own resolver also answered `{running:false}`
 * locally, so a tab on this instance rendered a streaming session as idle.
 *
 * Reconnection is the owner's business: this bridge does not retry, because a
 * silently reconnected relay would hide the owner being gone.
 */

import { sessionTopic } from '@/shared/lib/realtime/protocol';
import { getRealtimeHub } from '@/server/lib/realtime/hub.server';
import { peerRealtimeSocketUrl } from '@/server/lib/omp/rpc/peer-proxy.server';

/** One frame off the owner's socket, narrowed to the fields a relay reads. */
interface RelayedFrame {
  t?: string;
  topic?: string;
  payload?: unknown;
}

function parseFrame(raw: string): RelayedFrame | null {
  try {
    const value: unknown = JSON.parse(raw);
    return value && typeof value === 'object' ? (value as RelayedFrame) : null;
  } catch {
    return null;
  }
}

/**
 * Open a relay for `sessionId` against `origin` (the owner's base URL).
 *
 * Returns the cleanup that closes the upstream socket. Frames are filtered by
 * topic: the owner's socket is shared by every subscription it holds, so an
 * unfiltered relay would push another session's frames into this topic.
 */
export function attachPeerSession(sessionId: string, origin: string): () => void {
  const topic = sessionTopic(sessionId);
  const hub = getRealtimeHub();
  let upstream: WebSocket;
  try {
    upstream = new WebSocket(peerRealtimeSocketUrl(origin));
  } catch {
    return () => {};
  }

  upstream.onopen = () => {
    upstream.send(JSON.stringify({ t: 'subscribe', topics: [topic] }));
  };
  upstream.onmessage = (event) => {
    if (typeof event.data !== 'string') return;
    const frame = parseFrame(event.data);
    if (!frame || frame.topic !== topic) return;
    // The owner's snapshot IS this topic's baseline: the local resolver cannot
    // produce one, because the child is not here.
    if (frame.t === 'snapshot') hub.publishSnapshot(topic, frame.payload);
    else if (frame.t === 'delta') hub.publish(topic, frame.payload);
  };
  upstream.onerror = () => {};
  upstream.onclose = () => {};

  return () => {
    try {
      upstream.close();
    } catch {
      // Already gone.
    }
  };
}
