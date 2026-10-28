/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * `publishTopic` must re-resolve through the descriptor the HUB was registered
 * with.
 *
 * The failure this pins is silent in production and total: the publisher used
 * its own module-level descriptor table, which holds only the exact-name
 * topics. A scoped name (`git:<root>\0<repo>`, `fs:`, `repos:`, `wiki:`) is not
 * in that table, so the lookup returned `null` and every subscriber's panel was
 * BLANKED by a `delta null` instead of re-read — while the resolver that should
 * have run never did. The same lookup also bypassed the registered table
 * entirely, which is why a test with its own topic set saw the production
 * resolver run.
 */

import { afterEach, describe, expect, test, vi } from 'bun:test';

import { getRealtimeHub, registerTopics, resetRealtimeHub, type RealtimeConnection } from '@/server/lib/realtime/hub.server';
import { initRealtimeTopics, publishTopic, republishSessionDataTopics } from '@/server/lib/realtime/topics.server';
import { emitRealtimeSignal, clearRealtimeSignalListeners } from '@/server/lib/realtime/signals.server';
import { TOPIC_MODELS, TOPIC_USAGE, gitTopic, sessionQueueTopic, sessionTodosTopic, sessionTopic, type RealtimeServerFrame } from '@/shared/lib/realtime/protocol';

interface FakeConnection extends RealtimeConnection {
  frames: RealtimeServerFrame[];
}

function connect(): FakeConnection {
  const connection: FakeConnection = {
    topics: new Set<string>(),
    snapshotted: new Set<string>(),
    closed: false,
    frames: [],
    send: (frame) => {
      connection.frames.push(frame);
    },
  };
  return connection;
}

/**
 * Run the publisher's coalescing window and then drain the resolve's microtask
 * chain. Deterministic: the clock is advanced, not waited on.
 */
async function flushPublish(): Promise<void> {
  vi.advanceTimersByTime(200);
  for (let tick = 0; tick < 32; tick += 1) await Promise.resolve();
}

afterEach(() => {
  vi.useRealTimers();
  resetRealtimeHub();
  // The wiring test installs the real listener; leaving it in place would let a
  // later suite's signal reach this hub.
  clearRealtimeSignalListeners();
  globalThis.__kabmoRealtimeTopicsReady = undefined;
  // The dedupe/coalesce state is process state too; a payload identical to the
  // previous test's would otherwise be skipped as a no-op publish.
  globalThis.__kabmoRealtimePublish = undefined;
});

describe('publishTopic', () => {
  test('a scoped topic is re-resolved and its subscribers get the new value', async () => {
    vi.useFakeTimers();
    const topic = gitTopic('/ws\u0000.');
    let changes = 1;
    registerTopics(new Map([[topic, { resolve: async () => ({ changes }) }]]));

    const hub = getRealtimeHub();
    const connection = connect();
    hub.subscribe(connection, topic);
    for (let tick = 0; tick < 32; tick += 1) await Promise.resolve();
    expect(connection.frames).toHaveLength(1);

    changes = 3;
    connection.frames.length = 0;
    publishTopic(topic);
    await flushPublish();

    // A DELTA carrying the fresh payload — not `null`, which is what the
    // module-local lookup produced for a name it did not hold.
    expect(connection.frames).toEqual([
      { t: 'delta', topic, seq: 1, payload: { changes: 3 } },
    ]);
  });

  test('the registered resolver is the one called, not a module-local copy', async () => {
    vi.useFakeTimers();
    const topic = gitTopic('/ws\u0000.');
    let calls = 0;
    registerTopics(new Map([[topic, { resolve: async () => { calls += 1; return { marker: 'registered' }; } }]]));

    const hub = getRealtimeHub();
    const connection = connect();
    hub.subscribe(connection, topic);
    for (let tick = 0; tick < 32; tick += 1) await Promise.resolve();

    connection.frames.length = 0;
    publishTopic(topic);
    await flushPublish();

    expect(calls).toBe(2);
    expect(connection.frames[0]).toMatchObject({ t: 'delta', payload: { marker: 'registered' } });
  });
});

describe('initRealtimeTopics signal wiring', () => {
  /**
   * `models-changed` fires on every provider write — connect/disconnect, a new
   * models.yml entry, a key edit — and the Usage surfaces list exactly the
   * credentialed providers. The `usage` topic had NO producer at all: it
   * answered its snapshot on subscribe and then never moved, so a key added in
   * another tab (or by a settings write here) never reached an open panel.
   *
   * Both topics are watched here because the signal must republish both: the
   * model catalog and the credential list move together.
   */
  test('a models-changed signal republishes both models and usage', async () => {
    vi.useFakeTimers();
    // The real registration first (that is what installs the signal listener),
    // then the stubs override its descriptors — the hub reads whatever map was
    // registered last.
    globalThis.__kabmoRealtimeTopicsReady = undefined;
    initRealtimeTopics();
    let modelsCalls = 0;
    let usageCalls = 0;
    registerTopics(new Map([
      [TOPIC_MODELS, { resolve: async () => ({ models: ++modelsCalls }) }],
      [TOPIC_USAGE, { resolve: async () => ({ providers: ++usageCalls }) }],
    ]));

    const hub = getRealtimeHub();
    const connection = connect();
    hub.subscribe(connection, TOPIC_MODELS);
    hub.subscribe(connection, TOPIC_USAGE);
    for (let tick = 0; tick < 32; tick += 1) await Promise.resolve();
    connection.frames.length = 0;

    emitRealtimeSignal('models-changed');
    await flushPublish();

    expect(connection.frames).toEqual([
      { t: 'delta', topic: TOPIC_MODELS, seq: 1, payload: { models: 2 } },
      { t: 'delta', topic: TOPIC_USAGE, seq: 1, payload: { providers: 2 } },
    ]);
  });

  /**
   * The reported failure: "sometimes the second prompt's answer does not
   * stream until I reload". A session's omp child is routinely REPLACED under a
   * live subscriber — idle-reaped, respawned for an approval-mode change, or
   * restarted after a crash — and `attach` binds a topic to its source once per
   * subscription. Without a rebind the topic stays wired to the dead child, so
   * the client keeps its subscription and gets a snapshot (`running:true`, the
   * indicator resumes) and then NO frames, until a reload re-subscribes.
   * `session-attached` is raised by the spawn path exactly when the new child
   * is reachable, so it must both rebind and re-snapshot.
   */
  test('session-attached rebinds the topic and re-snapshots it', async () => {
    vi.useFakeTimers();
    globalThis.__kabmoRealtimeTopicsReady = undefined;
    initRealtimeTopics();
    const topic = sessionTopic('sess-1');
    let attaches = 0;
    let detaches = 0;
    let resolves = 0;
    // A fresh descriptor stands in for the session topic: the point is the
    // wiring, not the resolver's payload.
    registerTopics(new Map([[topic, {
      resolve: async () => ({ resolves: ++resolves }),
      attach: () => {
        attaches += 1;
        return () => {
          detaches += 1;
        };
      },
    }]]));

    const hub = getRealtimeHub();
    const connection = connect();
    hub.subscribe(connection, topic);
    await flushPublish();
    expect(attaches).toBe(1);

    connection.frames.length = 0;
    emitRealtimeSignal('session-attached', 'sess-1');
    await flushPublish();

    // Rebound to the replacement child AND re-snapshotted for the subscriber.
    expect(detaches).toBe(1);
    expect(attaches).toBe(2);
    expect(connection.frames).toEqual([{ t: 'snapshot', topic, seq: 0, payload: { resolves: 2 } }]);
  });
});

describe('republishSessionDataTopics', () => {
  /**
   * The four `session:<id>:<suffix>` topics are served by a resolver and nothing
   * else — no writer calls them. Without a republish they answered their
   * snapshot and then never moved, so the todo/plan/telemetry/queue panels
   * showed whatever existed when they subscribed and only a reload showed the
   * new state. This is that gap.
   */
  test('every WATCHED data topic of one session is re-resolved', async () => {
    vi.useFakeTimers();
    const sessionId = 'sess-1';
    const todos = sessionTodosTopic(sessionId);
    const queue = sessionQueueTopic(sessionId);
    const other = sessionTodosTopic('sess-2');
    let todosCalls = 0;
    let queueCalls = 0;
    registerTopics(new Map([
      [todos, { resolve: async () => { todosCalls += 1; return { todos: todosCalls }; } }],
      [queue, { resolve: async () => { queueCalls += 1; return { queue: queueCalls }; } }],
      [other, { resolve: async () => ({ todos: 'other' }) }],
    ]));

    const hub = getRealtimeHub();
    const connection = connect();
    hub.subscribe(connection, todos);
    hub.subscribe(connection, queue);
    for (let tick = 0; tick < 32; tick += 1) await Promise.resolve();
    expect(connection.frames).toHaveLength(2);

    connection.frames.length = 0;
    republishSessionDataTopics(sessionId);
    await flushPublish();

    expect(connection.frames).toEqual([
      { t: 'delta', topic: todos, seq: 1, payload: { todos: 2 } },
      { t: 'delta', topic: queue, seq: 1, payload: { queue: 2 } },
    ]);
    // Another session's topic is untouched, and an UNWATCHED topic of this one
    // is never resolved — the whole point of reading the subscribed set.
    expect(todosCalls).toBe(2);
    expect(queueCalls).toBe(2);
  });

  test('a session with nothing watched resolves nothing', async () => {
    vi.useFakeTimers();
    const sessionId = 'sess-1';
    let calls = 0;
    registerTopics(new Map([
      [sessionTodosTopic(sessionId), { resolve: async () => { calls += 1; return null; } }],
    ]));

    republishSessionDataTopics(sessionId);
    await flushPublish();

    expect(calls).toBe(0);
  });
});
