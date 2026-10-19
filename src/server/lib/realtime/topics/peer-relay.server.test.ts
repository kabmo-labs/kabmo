/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Peer bridging for a session topic.
 *
 * The failure this pins is silent and total: the relay dialed the per-session
 * agent socket (`/api/agent/<id>/ws`), which the realtime migration DELETED —
 * so the upstream answered 404, no frame ever arrived, and a tab on a second
 * Kabmo instance rendered a session that was streaming as idle.
 *
 * The peer here is a RAW WebSocket server speaking the realtime wire protocol,
 * not a second Kabmo hub: the hub is process-wide (`globalThis`), so an
 * in-process "owner" would share it and could not exercise the relay at all.
 * What is under test is the RELAY's own contract — dial the owner's unified
 * socket, subscribe the session topic on it, and republish the frames it gets
 * into this process's hub.
 *
 * Waiting is on the hub's own `send`, never on a duration.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { testPosix } from '@/test-support/platform';

import {
  getRealtimeHub,
  registerTopics,
  resetRealtimeHub,
} from '@/server/lib/realtime/hub.server';
import { attachPeerSession } from '@/server/lib/realtime/topics/peer-relay.server';
import { sessionDescriptor } from '@/server/lib/realtime/topics/session.server';
import { sessionTopic } from '@/shared/lib/realtime/protocol';
import {
  holdLeaseInForeignProcess,
  recordingConnection,
  startFakePeer,
  usePeerRoots,
  waitUntil,
  type FakePeer,
  type PeerRoots,
} from '@/test-support/peer-harness';

let roots: PeerRoots;
let peer: FakePeer | null = null;
const foreignChildren: number[] = [];

beforeEach(() => {
  roots = usePeerRoots();
});

afterEach(() => {
  for (const pid of foreignChildren.splice(0)) {
    try {
      process.kill(pid);
    } catch {
      // Already gone.
    }
  }
  peer?.stop();
  peer = null;
  roots.restore();
  rmSync(roots.stateRoot, { recursive: true, force: true });
  rmSync(roots.dataRoot, { recursive: true, force: true });
  resetRealtimeHub();
});

/** Subscribe a recording connection to `topic`, with a stub local resolver. */
function subscribeWithLocalStub(topic: string, local: unknown) {
  resetRealtimeHub();
  registerTopics(new Map([[topic, { resolve: async () => local }]]));
  const subscriber = recordingConnection();
  getRealtimeHub().subscribe(subscriber, topic);
  return subscriber;
}

describe('peer session relay', () => {
  test("the relay subscribes the session topic on the owner's unified socket", async () => {
    const sessionId = 'peer-session-1';
    const topic = sessionTopic(sessionId);
    peer = startFakePeer();
    subscribeWithLocalStub(topic, { running: false });

    const detach = attachPeerSession(sessionId, `http://127.0.0.1:${peer.port}`);
    try {
      // The subscription is the relay's whole handshake: a relay that dialed a
      // deleted path could never send one, because no route would have accepted
      // the upgrade.
      await waitUntil(() => peer !== null && peer.subscriptions.length > 0);
      // The dialed PATH is the load-bearing half: the per-session
      // `/api/agent/<id>/ws` this used to build was deleted with the realtime
      // migration, so on a real server the upgrade never happened at all.
      expect(peer.paths).toEqual(['/api/realtime/ws']);
      expect(peer.subscriptions[0]).toEqual([topic]);
    } finally {
      detach();
    }
  });

  test("the owner's snapshot becomes this topic's baseline, and its deltas arrive as deltas", async () => {
    const sessionId = 'peer-session-2';
    const topic = sessionTopic(sessionId);
    const resolved = { running: true, state: { isStreaming: true } };
    peer = startFakePeer();
    const subscriber = subscribeWithLocalStub(topic, { running: false });

    const detach = attachPeerSession(sessionId, `http://127.0.0.1:${peer.port}`);
    try {
      await waitUntil(() => peer !== null && peer.subscriptions.length > 0);

      peer.send({ t: 'snapshot', topic, seq: 0, payload: resolved });
      // The LOCAL resolver answered first (the hub resolves on subscribe) —
      // that is the other half of this bug: a process that does not hold the
      // child can only answer `{running:false}` locally, which is why the
      // resolver must forward. Here the peer's snapshot REPLACES it.
      const snapshot = await subscriber.awaitFrame(
        (frame) => frame.t === 'snapshot' && (frame.payload as { running?: boolean }).running === true,
      );
      expect(snapshot).toMatchObject({ t: 'snapshot', payload: resolved });

      // A delta must stay a delta: republishing it as a snapshot would reset
      // every subscriber's sequence baseline on every frame of a run.
      peer.send({ t: 'delta', topic, seq: 1, payload: { type: 'agent_start' } });
      const delta = await subscriber.awaitFrame((frame) => frame.t === 'delta');
      expect(delta).toMatchObject({ t: 'delta', payload: { type: 'agent_start' } });
      // The baseline the client keeps is the hub's own: a snapshot bumps the
      // sequence and the next delta follows it, so the two are contiguous and
      // the client never has to resync over a relayed run.
      const snapshotSeq = (snapshot as { seq?: number }).seq ?? -1;
      const deltaSeq = (delta as { seq?: number }).seq ?? -1;
      expect(deltaSeq).toBe(snapshotSeq + 1);
    } finally {
      detach();
    }
  });

  test('a frame for another topic is not republished into this one', async () => {
    const sessionId = 'peer-session-3';
    const topic = sessionTopic(sessionId);
    peer = startFakePeer();
    const subscriber = subscribeWithLocalStub(topic, { running: false });

    const detach = attachPeerSession(sessionId, `http://127.0.0.1:${peer.port}`);
    try {
      await waitUntil(() => peer !== null && peer.subscriptions.length > 0);

      // The owner's socket is shared by every subscription it holds, so an
      // unfiltered relay would push another session's run into this topic.
      peer.send({ t: 'snapshot', topic: sessionTopic('someone-else'), seq: 0, payload: { running: true } });
      peer.send({ t: 'delta', topic, seq: 1, payload: { type: 'agent_start' } });

      const delta = await subscriber.awaitFrame((frame) => frame.t === 'delta');
      expect(delta).toMatchObject({ payload: { type: 'agent_start' } });
      const otherTopic = subscriber.frames.filter((frame) => 'topic' in frame && frame.topic === sessionTopic('someone-else'));
      expect(otherTopic).toEqual([]);
    } finally {
      detach();
    }
  });

  test('an unreachable owner produces no frames and no throw', async () => {
    const sessionId = 'peer-session-4';
    const topic = sessionTopic(sessionId);
    const subscriber = subscribeWithLocalStub(topic, { running: false });

    // A port nothing listens on: the relay must fail quietly (the owner being
    // gone is not this instance's error to report) and leave the hub usable.
    const detach = attachPeerSession(sessionId, 'http://127.0.0.1:1');
    await waitUntil(() => getRealtimeHub().activeTopics().includes(topic));
    expect(subscriber.frames.every((frame) => 'topic' in frame && frame.topic === topic)).toBe(true);
    detach();
  });

  // `holdLeaseInForeignProcess` holds a real lease from a detached `sh -c` child
  // (`flock(2)`, `/bin/sh` — neither exists on Windows).
  testPosix('a session owned elsewhere resolves to the OWNER payload, not the local one', async () => {
    const sessionId = `peer-owned-${Date.now()}`;
    const topic = sessionTopic(sessionId);

    // The owner: a plain HTTP responder. What matters is that it is asked at
    // all — a local answer for a session this process does not hold can only be
    // `{running:false}`, which is the disagreement with the HTTP probe (which
    // forwards) this test exists to prevent.
    const ownerCalls: string[] = [];
    const ownerServer = Bun.serve({
      port: 0,
      fetch(request) {
        ownerCalls.push(new URL(request.url).pathname);
        return Response.json({ running: true, state: { isStreaming: true } });
      },
    });

    // The ownership guard reads an instance record from Kabmo data dir.
    mkdirSync(join(roots.dataRoot, 'run'), { recursive: true });
    writeFileSync(
      join(roots.dataRoot, 'run', `${ownerServer.port}.json`),
      JSON.stringify({ pid: 1, port: ownerServer.port, host: '127.0.0.1', mode: 'dev', launchMode: 'direct', startedAt: '', version: '0' }),
    );
    foreignChildren.push(await holdLeaseInForeignProcess(sessionId));

    try {
      const value = (await sessionDescriptor(sessionId).resolve(topic)) as { running?: boolean };
      expect(ownerCalls).toEqual([`/api/agent/${sessionId}`]);
      expect(value.running).toBe(true);
    } finally {
      ownerServer.stop(true);
    }
  });

  testPosix('a subscribe made BEFORE the owner claims the session still attaches', async () => {
    const sessionId = `peer-late-${Date.now()}`;
    const topic = sessionTopic(sessionId);
    peer = startFakePeer();
    subscribeWithLocalStub(topic, { running: false });

    // The owner must be placeable once it claims the session: the guard matches
    // the holder's PARENT against an instance record. The foreign holder is
    // reparented to init (pid 1), so that is the pid the record names.
    mkdirSync(join(roots.dataRoot, 'run'), { recursive: true });
    writeFileSync(
      join(roots.dataRoot, 'run', `${peer.port}.json`),
      JSON.stringify({ pid: 1, port: peer.port, host: '127.0.0.1', mode: 'dev', launchMode: 'direct', startedAt: '', version: '0' }),
    );

    // The subscribe lands first: at this moment nothing holds the lease, which
    // is exactly the state a real spawn leaves for several seconds (measured:
    // the lease appeared ~8s after `/api/agent/new` returned). The topic's
    // `attach` runs ONCE per subscription, so a one-shot lookup would leave the
    // tab showing a run it never receives.
    const detach = sessionDescriptor(sessionId).attach?.(topic);
    try {
      await waitUntil(() => peer !== null && peer.subscriptions.length === 0);
      // Only NOW does the owner appear — after the first lookup found nothing.
      foreignChildren.push(await holdLeaseInForeignProcess(sessionId));
      // The descriptor retries on a 2s interval, so the wait must outlast one.
      await waitUntil(() => peer !== null && peer.subscriptions.length > 0, 8_000);
      expect(peer.paths).toEqual(['/api/realtime/ws']);
      expect(peer.subscriptions[0]).toEqual([topic]);
    } finally {
      detach?.();
    }
  });
});
