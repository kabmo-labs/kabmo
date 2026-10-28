/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The `session:<id>` topic: one session's live state and its agent frames.
 *
 * The snapshot is `buildAgentSnapshot` — the SAME builder `GET
 * /api/agent/:sessionId` answers from. A session owned by ANOTHER instance is
 * the exception the route also makes: the owner's own payload is forwarded,
 * because this process holds no child and its local builder can only answer
 * `{running:false}`. Without that forward the two surfaces disagree for one
 * question — the HTTP probe says `running:true` (forwarded) while the topic
 * says `false` (local) — and a tab on this instance shows a session that is
 * streaming with a timeline that never moves.
 *
 * `attach` binds the child's event fanout while anyone is watching, which is
 * what makes the topic push frames instead of every client holding a socket per
 * session. A session with no live child resolves to `{running:false}` and then
 * publishes nothing — correct, because there is no run to report. The spawn path
 * calls `publishSessionState` once the child exists, which re-snapshots this
 * topic for every subscriber.
 */

import { sessionTopic } from '@/shared/lib/realtime/protocol';
import { getRealtimeHub, type TopicDescriptor } from '@/server/lib/realtime/hub.server';
import { buildAgentSnapshot, type AgentSnapshot } from '@/server/routes/agent/command';
import {
  fetchPeerSessionSnapshot,
  peerOriginForSession,
} from '@/server/lib/omp/rpc/peer-proxy.server';
import { getRpcSession } from '@/server/lib/omp/rpc/manager';
import { attachPeerSession } from '@/server/lib/realtime/topics/peer-relay.server';
import { isRecord } from '@/shared/lib/util/guards';

/**
 * How long to keep looking for the owning instance after a subscribe found none.
 *
 * The owner's session lease is written only once omp has opened the session
 * file, which on a real spawn is several seconds AFTER the child exists
 * (measured: the lease appeared ~8s after `/api/agent/new` returned). A
 * subscribe inside that window sees no owner and would otherwise give up for
 * the life of the subscription — the relay is attached once per topic, so a
 * one-shot miss leaves the tab showing a run it never receives.
 */
const PEER_ORIGIN_RETRY_MS = 2_000;
const PEER_ORIGIN_ATTEMPTS = 8;

/**
 * The owner's payload as this topic's snapshot.
 *
 * The forwarded body is UNVALIDATED — it arrives from another process over the
 * network — so it is read for the one field every consumer branches on
 * (`running`) and passed through unchanged otherwise: the snapshot's `state` is
 * omp's own opaque shape, exactly as the local builder returns it.
 */
function asAgentSnapshot(value: unknown): AgentSnapshot | null {
  if (!isRecord(value) || typeof value.running !== 'boolean') return null;
  return value as unknown as AgentSnapshot;
}

/**
 * Relay the owner's frames while `isCancelled()` is false, retrying the
 * ownership lookup so a subscribe during the owner's spawn window still lands.
 */
function relayOwnerStream(sessionId: string, isCancelled: () => boolean): () => void {
  let detach: (() => void) | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const attempt = (remaining: number): void => {
    if (isCancelled() || remaining <= 0) return;
    void peerOriginForSession(sessionId).then((origin) => {
      if (isCancelled()) return;
      if (!origin) {
        timer = setTimeout(() => attempt(remaining - 1), PEER_ORIGIN_RETRY_MS);
        return;
      }
      detach = attachPeerSession(sessionId, origin);
    });
  };
  attempt(PEER_ORIGIN_ATTEMPTS);

  return () => {
    clearTimeout(timer);
    timer = undefined;
    detach?.();
  };
}

export function sessionDescriptor(sessionId: string): TopicDescriptor {
  return {
    resolve: async (): Promise<AgentSnapshot> => {
      const session = getRpcSession(sessionId);
      if (session?.isAlive()) return buildAgentSnapshot(sessionId);
      // Not ours: answer with the OWNER's payload, the way the HTTP route does.
      // A session that is free (no owner) keeps the local answer.
      const origin = await peerOriginForSession(sessionId);
      if (!origin) return buildAgentSnapshot(sessionId);
      const forwarded = asAgentSnapshot(await fetchPeerSessionSnapshot(sessionId, origin));
      return forwarded ?? buildAgentSnapshot(sessionId);
    },

    attach: () => {
      const session = getRpcSession(sessionId);
      if (session?.isAlive()) {
        return session.onEvent((event) => {
          getRealtimeHub().publish(sessionTopic(sessionId), event);
        });
      }
      // Not owned HERE: the session may be running on another instance, in which
      // case this topic relays that instance's frames. Resolved asynchronously —
      // `attach` is synchronous — so the relay's snapshot establishes the
      // baseline once it arrives.
      let cancelled = false;
      const stopRelay = relayOwnerStream(sessionId, () => cancelled);
      return () => {
        cancelled = true;
        stopRelay();
      };
    },
  };
}
