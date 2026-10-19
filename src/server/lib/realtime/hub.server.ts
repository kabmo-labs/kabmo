/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The Kabmo's realtime hub: the one place a server-originated event enters,
 * and the one place it leaves from. Every publisher calls
 * `publish(topic, payload)`; every subscriber is a WebSocket connection from
 * `@/server/routes/realtime/ws`. Nothing else fans out to clients.
 *
 * A snapshot is BUFFERED, not just sent: it is produced by an async resolver,
 * so there is a window between "subscribed" and "its snapshot exists".
 * Registering after the resolve loses a delta that lands inside that window;
 * registering before it without buffering hands the client `delta seq 7` ahead
 * of `snapshot seq 5`. The order is register → note `seq` → resolve → send the
 * snapshot stamped with that `seq` → replay the deltas published meanwhile.
 * `seq` is contiguous per topic, which is what lets a client detect a gap and
 * ask for `resync` instead of sitting on stale data.
 *
 * Concurrent subscribers share one resolve; a later one starts a fresh resolve
 * rather than a cached answer, because caching would reintroduce the staleness
 * this transport exists to remove.
 *
 * State is anchored on `globalThis` for the reason the database handle is:
 * `bun --hot` re-evaluates this module while the sockets it serves live on, so a
 * module-level binding would orphan every connection's subscription.
 */

import type {
  HubState,
  RealtimeConnection,
  RealtimeHub,
  TopicDescriptor,
  TopicEntry,
} from '@/server/lib/realtime/hub.types';

export type {
  PendingDelta,
  RealtimeConnection,
  RealtimeHub,
  TopicDescriptor,
  TopicEntry,
  TopicResolver,
} from '@/server/lib/realtime/hub.types';

/**
 * Most deltas held while a snapshot resolves. A resolve is a few milliseconds
 * of work, so overflow means a burst far beyond anything Kabmo produces;
 * a connection that overflows is re-resolved rather than served a partial
 * replay, because a silent gap is the one outcome this transport must not have.
 */
const MAX_PENDING_DELTAS = 256;

declare global {
  // eslint-disable-next-line no-var
  var __kabmoRealtimeHub: HubState | undefined;
  // eslint-disable-next-line no-var
  var __kabmoRealtimeHubInstance: RealtimeHub | undefined;
}

function state(): HubState {
  return (globalThis.__kabmoRealtimeHub ??= { topics: new Map(), descriptors: new Map() });
}

/**
 * Register the topics this hub serves. Called once at boot with the full
 * registry; a later call replaces the descriptor set (a hot reload
 * re-registers).
 */
export function registerTopics(descriptors: Map<string, TopicDescriptor>): void {
  const host = state();
  host.descriptors = descriptors;
}

export function createHub(): RealtimeHub {
  const entryFor = (topic: string): TopicEntry => {
    const host = state();
    let entry = host.topics.get(topic);
    if (!entry) {
      entry = { seq: 0, subscribers: new Set(), detach: null, buffer: [], resolve: null, baseSeq: 0, overflowed: false };
      host.topics.set(topic, entry);
    }
    return entry;
  };

  /** Drop a topic entry once nothing is watching it, so memory tracks demand. */
  const reapIfIdle = (topic: string, entry: TopicEntry): void => {
    if (entry.subscribers.size === 0 && entry.resolve === null) state().topics.delete(topic);
  };

  /**
   * Serve one connection its snapshot, joining an in-flight resolve or starting
   * one. Attempts are bounded: a connection that overflows the delta buffer is
   * re-resolved once, and a second overflow is reported as an error rather than
   * looping forever on a pathologically hot topic.
   */
  const deliverSnapshot = async (topic: string, connection: RealtimeConnection, attempt = 0): Promise<void> => {
    const host = state();
    const entry = entryFor(topic);
    const resolver = host.descriptors.get(topic)?.resolve;
    if (!resolver) {
      connection.send({ t: 'error', code: 'unknown_topic', message: `Unknown topic: ${topic}`, topic });
      return;
    }

    if (entry.resolve === null) {
      entry.baseSeq = entry.seq;
      entry.buffer = [];
      entry.overflowed = false;
      entry.resolve = resolver(topic).then(
        (payload) => ({ ok: true as const, payload }),
        (error: unknown) => ({ ok: false as const, error }),
      );
      // Clear the slot only after every awaiting connection has been served, so
      // a subscriber arriving mid-flight joins THIS resolve rather than starting
      // a second scan for the same topic.
      void entry.resolve.then(() => {
        entry.resolve = null;
      });
    }

    const result = await entry.resolve;
    if (connection.closed || !connection.topics.has(topic)) return;

    if (!result.ok) {
      const message = result.error instanceof Error ? result.error.message : String(result.error);
      connection.send({ t: 'error', code: 'snapshot_failed', message, topic });
      return;
    }

    if (entry.overflowed) {
      if (attempt >= 1) {
        connection.send({
          t: 'error',
          code: 'snapshot_failed',
          message: `Topic ${topic} changed faster than its snapshot could be delivered.`,
          topic,
        });
        return;
      }
      // A fresh snapshot is the honest repair: the buffered deltas are gone.
      void deliverSnapshot(topic, connection, attempt + 1);
      return;
    }

    const baseSeq = entry.baseSeq;
    const replay = entry.buffer.filter((delta) => delta.seq > baseSeq);
    connection.send({ t: 'snapshot', topic, seq: baseSeq, payload: result.payload });
    for (const delta of replay) {
      if (connection.closed) return;
      connection.send({ t: 'delta', topic, seq: delta.seq, payload: delta.payload });
    }
    connection.snapshotted.add(topic);
  };

  /** Run the descriptor's `attach` for `topic` and store its cleanup. */
  const bind = (topic: string, entry: TopicEntry): void => {
    const attach = state().descriptors.get(topic)?.attach;
    if (!attach) return;
    try {
      entry.detach = attach(topic) ?? null;
    } catch {
      entry.detach = null;
    }
  };

  /** Release the descriptor's binding, if any. */
  const dropBinding = (entry: TopicEntry): void => {
    const detach = entry.detach;
    entry.detach = null;
    if (!detach) return;
    try {
      detach();
    } catch {
      // Unbinding is best-effort; a throwing cleanup must not break the caller.
    }
  };

  /** Drop the descriptor's binding once nobody is watching. */
  const detachIfIdle = (entry: TopicEntry): void => {
    if (entry.subscribers.size > 0 || entry.detach === null) return;
    dropBinding(entry);
  };

  return {
    knows: (topic) => state().descriptors.has(topic),

    resolve: (topic) => {
      const descriptor = state().descriptors.get(topic);
      if (!descriptor) return Promise.reject(new Error(`Unknown topic: ${topic}`));
      return descriptor.resolve(topic);
    },

    subscribe(connection, topic) {
      const entry = entryFor(topic);
      const first = entry.subscribers.size === 0;
      entry.subscribers.add(connection);
      connection.topics.add(topic);
      connection.snapshotted.delete(topic);
      // Bind the source BEFORE the snapshot resolves: a delta published while
      // the snapshot is in flight must reach the buffer, and an unbound source
      // would simply never produce one.
      if (first && entry.detach === null) bind(topic, entry);
      void deliverSnapshot(topic, connection);
    },

    unsubscribe(connection, topic) {
      const entry = entryFor(topic);
      entry.subscribers.delete(connection);
      connection.topics.delete(topic);
      connection.snapshotted.delete(topic);
      detachIfIdle(entry);
      reapIfIdle(topic, entry);
    },

    release(connection) {
      connection.closed = true;
      for (const topic of [...connection.topics]) {
        const entry = state().topics.get(topic);
        if (!entry) continue;
        entry.subscribers.delete(connection);
        detachIfIdle(entry);
        reapIfIdle(topic, entry);
      }
      connection.topics.clear();
      connection.snapshotted.clear();
    },

    publishSnapshot(topic, payload) {
      const entry = entryFor(topic);
      entry.seq += 1;
      const seq = entry.seq;
      // The buffer is dropped: a snapshot supersedes whatever it held, and the
      // awaiting connections are about to be given this baseline.
      entry.buffer = [];
      entry.overflowed = false;
      for (const connection of entry.subscribers) {
        if (connection.closed) continue;
        connection.snapshotted.add(topic);
        connection.send({ t: 'snapshot', topic, seq, payload });
      }
    },

    republishSnapshot(topic) {
      const entry = state().topics.get(topic);
      if (!entry || entry.subscribers.size === 0) return;
      // Re-resolve for EVERY subscriber: they are all at the same baseline, and
      // a fresh snapshot is what repairs each of them.
      for (const connection of [...entry.subscribers]) {
        connection.snapshotted.delete(topic);
        void deliverSnapshot(topic, connection);
      }
    },

    rebind(topic) {
      const entry = state().topics.get(topic);
      // Nobody is watching: there is no binding to repair, and a topic with no
      // subscribers must not hold a source open (see `detachIfIdle`).
      if (!entry || entry.subscribers.size === 0) return;
      // Replace the source binding wholesale. `attach` is bound ONCE per
      // subscription, so a source that is REPLACED under a live subscriber (a
      // session's omp child respawned by the idle reaper, an approval-mode
      // reconcile, a crash) leaves the topic wired to the dead one — the
      // subscriber keeps its subscription and receives snapshots but no frames,
      // which reads as "the answer never streamed until I reloaded".
      dropBinding(entry);
      bind(topic, entry);
    },

    publish(topic, payload) {
      const entry = entryFor(topic);
      entry.seq += 1;
      const seq = entry.seq;

      // A connection still waiting on its snapshot cannot receive this as a
      // live delta; the buffer is what it replays after the snapshot lands.
      const awaiting = [...entry.subscribers].some((connection) => !connection.snapshotted.has(topic));
      if (awaiting) {
        if (entry.buffer.length >= MAX_PENDING_DELTAS) {
          entry.overflowed = true;
          entry.buffer = [];
        } else {
          entry.buffer.push({ seq, payload });
        }
      }

      for (const connection of entry.subscribers) {
        if (connection.closed || !connection.snapshotted.has(topic)) continue;
        connection.send({ t: 'delta', topic, seq, payload });
      }
    },

    sequenceOf: (topic) => entryFor(topic).seq,

    activeTopics() {
      const names: string[] = [];
      for (const [topic, entry] of state().topics) {
        if (entry.subscribers.size > 0) names.push(topic);
      }
      return names;
    },
  };
}

/**
 * The process's single hub. Publishers and the WS route both resolve it here so
 * a hot reload cannot leave a publisher writing into a discarded instance.
 */
export function getRealtimeHub(): RealtimeHub {
  return (globalThis.__kabmoRealtimeHubInstance ??= createHub());
}

/** Test seam: drop the hub and its topic state. */
export function resetRealtimeHub(): void {
  globalThis.__kabmoRealtimeHub = undefined;
  globalThis.__kabmoRealtimeHubInstance = undefined;
}
