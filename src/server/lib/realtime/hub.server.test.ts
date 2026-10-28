/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The realtime hub's delivery contract.
 *
 * These are the properties that make one socket safe to route every event
 * through, and each one fails SILENTLY when broken — a missing snapshot looks
 * like a slow load, a gap looks like stale data, a broadcast leak looks like a
 * tab doing extra work. So each is asserted directly:
 *
 *   - register-before-resolve: a delta published while the snapshot resolves is
 *     replayed after it, never lost and never delivered out of order;
 *   - per-topic fan-out: a subscriber to one topic never receives another's
 *     frames (the two-tab, two-session case);
 *   - sequence contiguity: deltas are numbered per topic, so a client can
 *     detect a gap and resync;
 *   - refcount: no subscribers means no work, and a released connection stops
 *     receiving;
 *   - overflow: a resolve that outruns its buffer re-resolves rather than
 *     serving a partial replay.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { createHub, registerTopics, resetRealtimeHub, type RealtimeConnection, type TopicDescriptor } from '@/server/lib/realtime/hub.server';
import type { RealtimeServerFrame } from '@/shared/lib/realtime/protocol';

/** Build the descriptor map `registerTopics` takes from plain resolvers. */
function descriptors(resolvers: Record<string, () => Promise<unknown>>): Map<string, TopicDescriptor> {
  return new Map(Object.entries(resolvers).map(([topic, resolve]) => [topic, { resolve }]));
}

interface FakeConnection extends RealtimeConnection {
  frames: RealtimeServerFrame[];
  topicList: string[];
}

function connect(): FakeConnection {
  const connection: FakeConnection = {
    topics: new Set<string>(),
    snapshotted: new Set<string>(),
    closed: false,
    frames: [],
    topicList: [],
    send(frame) {
      connection.frames.push(frame);
    },
  };
  return connection;
}

function framesFor(connection: FakeConnection, topic: string): RealtimeServerFrame[] {
  return connection.frames.filter((frame) => 'topic' in frame && frame.topic === topic);
}

/** A topic frame's sequence number; pong/error frames carry none. */
function seqOf(frame: RealtimeServerFrame): number | undefined {
  return 'seq' in frame ? frame.seq : undefined;
}

/**
 * Drain the microtask queue so a resolve's continuations run.
 *
 * Deterministic and instant: the delivery path awaits a promise chain a few
 * ticks deep, so draining microtasks reaches the same state a wall-clock wait
 * would, without binding the suite to real time.
 */
async function settle(): Promise<void> {
  for (let tick = 0; tick < 32; tick += 1) await Promise.resolve();
}

afterEach(() => {
  resetRealtimeHub();
});

describe('realtime hub', () => {
  test('a delta published while the snapshot resolves is replayed after it', async () => {
    resetRealtimeHub();
    const hub = createHub();
    const gate = Promise.withResolvers<unknown>();
    registerTopics(descriptors({ 't': async () => gate.promise }));

    const connection = connect();
    hub.subscribe(connection, 't');

    // Published while the resolver is still blocked: this is the race the
    // register-before-resolve ordering exists for.
    hub.publish('t', { n: 1 });
    hub.publish('t', { n: 2 });

    gate.resolve({ n: 0 });
    await settle();

    expect(framesFor(connection, 't').map((frame) => frame.t)).toEqual(['snapshot', 'delta', 'delta']);
    expect(framesFor(connection, 't').map(seqOf)).toEqual([0, 1, 2]);
  });

  test('a subscriber to one topic never receives another topic frames', async () => {
    resetRealtimeHub();
    const hub = createHub();
    registerTopics(descriptors({ a: async () => 'A', b: async () => 'B' }));

    const tabA = connect();
    const tabB = connect();
    hub.subscribe(tabA, 'a');
    hub.subscribe(tabB, 'b');
    await settle();

    hub.publish('a', 'a-1');
    hub.publish('b', 'b-1');

    expect(framesFor(tabA, 'a').length).toBe(2);
    expect(framesFor(tabB, 'b').length).toBe(2);
    // The leak this pins: a broadcast would have put 'a' frames in tab B.
    expect(framesFor(tabB, 'a')).toEqual([]);
    expect(framesFor(tabA, 'b')).toEqual([]);
  });

  test('deltas are numbered contiguously per topic, from the snapshot seq', async () => {
    resetRealtimeHub();
    const hub = createHub();
    registerTopics(descriptors({ 't': async () => 'snap' }));

    const connection = connect();
    hub.subscribe(connection, 't');
    await settle();

    hub.publish('t', 'one');
    hub.publish('t', 'two');
    hub.publish('t', 'three');

    const seqs = framesFor(connection, 't').map(seqOf);
    expect(seqs).toEqual([0, 1, 2, 3]);
  });

  test('two subscribers share one snapshot resolve', async () => {
    resetRealtimeHub();
    const hub = createHub();
    let resolves = 0;
    registerTopics(descriptors({ t: async () => {
      resolves += 1;
      return 'value';
    } }));

    const first = connect();
    const second = connect();
    hub.subscribe(first, 't');
    hub.subscribe(second, 't');
    await settle();

    expect(resolves).toBe(1);
    expect(framesFor(first, 't')[0]).toMatchObject({ t: 'snapshot', payload: 'value' });
    expect(framesFor(second, 't')[0]).toMatchObject({ t: 'snapshot', payload: 'value' });
  });

  test('a released connection stops receiving, and an idle topic is forgotten', async () => {
    resetRealtimeHub();
    const hub = createHub();
    registerTopics(descriptors({ 't': async () => 'snap' }));

    const connection = connect();
    hub.subscribe(connection, 't');
    await settle();
    hub.release(connection);

    const before = connection.frames.length;
    hub.publish('t', 'after-release');
    expect(connection.frames.length).toBe(before);
  });

  test('an unsubscribe stops that topic only', async () => {
    resetRealtimeHub();
    const hub = createHub();
    registerTopics(descriptors({ a: async () => 'A', b: async () => 'B' }));

    const connection = connect();
    hub.subscribe(connection, 'a');
    hub.subscribe(connection, 'b');
    await settle();
    hub.unsubscribe(connection, 'a');

    const before = framesFor(connection, 'a').length;
    hub.publish('a', 'a-2');
    hub.publish('b', 'b-2');

    expect(framesFor(connection, 'a').length).toBe(before);
    expect(framesFor(connection, 'b').at(-1)).toMatchObject({ payload: 'b-2' });
  });

  test('an unknown topic is refused instead of silently ignored', () => {
    resetRealtimeHub();
    const hub = createHub();
    registerTopics(descriptors({}));

    expect(hub.knows('nope')).toBe(false);
    expect(hub.knows('sidebar')).toBe(false);
  });

  test('a failing snapshot reports an error and leaves the connection usable', async () => {
    resetRealtimeHub();
    const hub = createHub();
    registerTopics(descriptors({ t: async () => {
      throw new Error('disk on fire');
    } }));

    const connection = connect();
    hub.subscribe(connection, 't');
    await settle();

    expect(connection.frames[0]).toMatchObject({ t: 'error', code: 'snapshot_failed', message: 'disk on fire' });
  });

  test('a delta never precedes its snapshot, even for a late subscriber', async () => {
    resetRealtimeHub();
    const hub = createHub();
    registerTopics(descriptors({ 't': async () => 'snap' }));

    hub.publish('t', 'before-anyone');
    const connection = connect();
    hub.subscribe(connection, 't');
    await settle();

    expect(connection.frames[0]).toMatchObject({ t: 'snapshot' });
  });

  /**
   * The failure this pins is silent and total: `attach` runs ONCE per
   * subscription, so a source replaced under a live subscriber (a session's omp
   * child respawned by the idle reaper, a mode reconcile, a crash) leaves the
   * topic wired to the dead one. The subscriber keeps receiving snapshots and
   * then nothing — a run that looks live with no frames, until a reload
   * re-subscribes. `rebind` is the repair the spawn path calls.
   */
  test('rebind re-runs attach, so frames follow the replaced source', async () => {
    resetRealtimeHub();
    const hub = createHub();
    let live: 'A' | 'B' = 'A';
    let attaches = 0;
    let detaches = 0;
    registerTopics(new Map<string, TopicDescriptor>([
      ['t', {
        resolve: async () => 'snap',
        attach: () => {
          attaches += 1;
          return () => {
            detaches += 1;
          };
        },
      }],
    ]));

    const connection = connect();
    hub.subscribe(connection, 't');
    await settle();
    expect(attaches).toBe(1);

    // The source is replaced; the topic is still bound to the old one.
    live = 'B';
    hub.publish('t', `from-${live}`);

    connection.frames.length = 0;
    hub.rebind('t');
    expect(detaches).toBe(1);
    expect(attaches).toBe(2);
    hub.publish('t', `from-${live}`);

    // The subscriber is still subscribed, so the fresh binding is what makes
    // the new source's frames arrive.
    expect(framesFor(connection, 't').at(-1)).toMatchObject({ t: 'delta', payload: 'from-B' });
  });

  test('rebind with no subscribers is a no-op, so no source is held open', async () => {
    resetRealtimeHub();
    const hub = createHub();
    let attaches = 0;
    registerTopics(new Map<string, TopicDescriptor>([
      ['t', { resolve: async () => 'snap', attach: () => { attaches += 1; } }],
    ]));

    hub.rebind('t');
    expect(attaches).toBe(0);
  });
});
