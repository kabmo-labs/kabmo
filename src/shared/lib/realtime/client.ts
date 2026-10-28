/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The client half of the unified realtime channel: one socket per tab, shared
 * by every consumer through refcounted topic subscriptions.
 *
 * One socket, not one per feature. A tab that shows a chat, a git panel and a
 * sidebar used to hold a socket plus several polls; it now holds one socket and
 * three topic subscriptions.
 *
 * The socket's own lifecycle (dial, backoff, status) lives in `connection.ts`;
 * this module owns TOPICS — the values, the frames, and the sequence rules that
 * decide when a value can be trusted.
 *
 * ## Sequence tracking, and why a gap forces a resync
 *
 * The server numbers each topic's frames contiguously. A `snapshot` resets the
 * baseline, a `delta` must follow its predecessor. A frame that does not is
 * DROPPED and the topic is marked `stale` while a `resync` asks for a fresh
 * snapshot — because applying an out-of-order delta silently renders a state
 * the server never had, and the alternative to resyncing is showing wrong data
 * indefinitely.
 */

import {
  decodeServerFrame,
  type RealtimeServerFrame,
} from '@/shared/lib/realtime/protocol';
import {
  connectIfNeeded,
  notePong,
  resetConnection,
} from '@/shared/lib/realtime/connection';
import {
  configureConnection,
  currentStatus,
  onStatusChange,
  send,
  setSocketConstructor,
  setWanted,
  type RealtimeStatus,
} from '@/shared/lib/realtime/state';

export type { RealtimeStatus };

export type RealtimeTopicListener = () => void;

/** One frame delivered to a `subscribeFrames` consumer. */
export interface RealtimeFrame<T = unknown> {
  kind: 'snapshot' | 'delta';
  topic: string;
  seq: number;
  payload: T;
}

/**
 * A frame consumer — for a topic whose payload is an EVENT STREAM rather than a
 * value.
 *
 * The value API (`subscribe` + `read`) keeps the latest payload, which is right
 * for a panel that renders state. It is wrong for a session's agent frames: a
 * timeline must fold EVERY `message_update` / `tool_execution_end`, and
 * collapsing them to the last one would drop the run. So this path delivers
 * each frame in order and keeps no value.
 */
export type RealtimeFrameListener = (frame: RealtimeFrame) => void;

interface TopicEntry {
  data: unknown;
  /** Last applied sequence number. -1 until the first snapshot lands. */
  seq: number;
  /** A gap was seen; the value on hand is not known to be current. */
  stale: boolean;
  /** A resync is in flight, so a second gap does not send another. */
  resyncing: boolean;
  listeners: Set<RealtimeTopicListener>;
  /** Frame consumers. A topic may have both kinds of subscriber. */
  frameListeners: Set<RealtimeFrameListener>;
}

interface TopicState {
  topics: Map<string, TopicEntry>;
}

declare global {
  // eslint-disable-next-line no-var
  var __kabmoRealtimeTopics: TopicState | undefined;
}

function topics(): TopicState {
  return (globalThis.__kabmoRealtimeTopics ??= { topics: new Map() });
}

function entryFor(topic: string): TopicEntry {
  const host = topics();
  let entry = host.topics.get(topic);
  if (!entry) {
    entry = { data: null, seq: -1, stale: false, resyncing: false, listeners: new Set(), frameListeners: new Set() };
    host.topics.set(topic, entry);
  }
  return entry;
}

function notifyTopic(topic: string): void {
  const entry = topics().topics.get(topic);
  if (!entry) return;
  for (const listener of [...entry.listeners]) listener();
}

/** Deliver one frame to a topic's frame consumers, in arrival order. */
function deliverFrame(topic: string, kind: 'snapshot' | 'delta', seq: number, payload: unknown): void {
  const entry = topics().topics.get(topic);
  if (!entry || entry.frameListeners.size === 0) return;
  for (const listener of [...entry.frameListeners]) {
    try {
      listener({ kind, topic, seq, payload });
    } catch {
      // A throwing consumer must not starve the others or break the socket's
      // message handler, which is shared by every topic.
    }
  }
}

/** Topics that have at least one subscriber of either kind. */
function isWatched(entry: TopicEntry): boolean {
  return entry.listeners.size > 0 || entry.frameListeners.size > 0;
}

function liveTopics(): string[] {
  const names: string[] = [];
  for (const [topic, entry] of topics().topics) {
    if (isWatched(entry)) names.push(topic);
  }
  return names;
}

/** True while some subscription exists, so the connection stays wanted. */
function refreshWanted(): void {
  setWanted(liveTopics().length > 0);
}

function applySnapshot(topic: string, seq: number, payload: unknown): void {
  const entry = entryFor(topic);
  entry.data = payload;
  entry.seq = seq;
  entry.stale = false;
  entry.resyncing = false;
  notifyTopic(topic);
  deliverFrame(topic, 'snapshot', seq, payload);
}

function applyDelta(topic: string, seq: number, payload: unknown): void {
  const entry = entryFor(topic);
  // No snapshot yet: a delta cannot be placed, so it is dropped and a snapshot
  // is requested. Applying it would show a value with no baseline.
  if (entry.seq === -1 || seq !== entry.seq + 1) {
    entry.stale = true;
    requestResync(topic);
    return;
  }
  entry.data = payload;
  entry.seq = seq;
  notifyTopic(topic);
  deliverFrame(topic, 'delta', seq, payload);
}

function requestResync(topic: string): void {
  const entry = entryFor(topic);
  if (entry.resyncing) return;
  entry.resyncing = true;
  if (!send({ t: 'resync', topics: [topic] })) {
    // Not connected: the reconnect path resubscribes everything, which is the
    // same repair, so drop the flag rather than leaving the topic wedged.
    entry.resyncing = false;
  }
}

/** Handle one decoded server frame. */
function handleFrame(raw: string): void {
  const frame: RealtimeServerFrame | null = decodeServerFrame(raw);
  if (!frame) return;
  switch (frame.t) {
    case 'snapshot':
      applySnapshot(frame.topic, frame.seq, frame.payload);
      break;
    case 'delta':
      applyDelta(frame.topic, frame.seq, frame.payload);
      break;
    case 'error':
      // A topic error leaves the last good value on screen; the caller's own
      // `stale` state is what tells a panel to say so.
      if (frame.topic) {
        const entry = entryFor(frame.topic);
        entry.stale = true;
        entry.resyncing = false;
        notifyTopic(frame.topic);
      }
      break;
    case 'pong':
      // A resume probe's answer: the socket that LOOKED open really is.
      notePong(frame.id);
      break;
  }
}

/** Drop every topic's baseline after the socket went away: values are of
 *  unknown age, and the next snapshot is what repairs them. */
export function markTopicsStale(): void {
  for (const [topic, entry] of topics().topics) {
    if (!isWatched(entry)) continue;
    entry.stale = true;
    entry.seq = -1;
    entry.resyncing = false;
    notifyTopic(topic);
  }
}

configureConnection(handleFrame, liveTopics, markTopicsStale);

export interface RealtimeClient {
  /** Observe a topic. The first listener connects; the last one disconnects. */
  subscribe: (topic: string, listener: RealtimeTopicListener) => () => void;
  /**
   * Observe a topic's FRAMES. For an event-stream topic (a session's agent
   * events, a session's BTW frames) where every payload matters and collapsing
   * to the latest would drop the run.
   */
  subscribeFrames: (topic: string, listener: RealtimeFrameListener) => () => void;
  /** The last value received for a topic, or null before its first snapshot. */
  read: <T>(topic: string) => T | null;
  /** True when the value on hand is not known to be current. */
  isStale: (topic: string) => boolean;
  /** Ask for a fresh snapshot (a panel's own Refresh button). */
  refresh: (topic: string) => void;
  /** Observe the channel's own status. */
  onStatus: (listener: () => void) => () => void;
  status: () => RealtimeStatus;
  /**
   * Override the socket constructor. Test-only: a suite driving the channel
   * through a real listener injects the runner's own `WebSocket`, so another
   * suite's stub cannot capture its dial.
   */
  setSocketConstructor: (ctor: typeof WebSocket | null) => void;
}

/** Shared by both subscribe paths: release the topic once nobody watches it. */
function releaseTopic(topic: string): void {
  const current = topics().topics.get(topic);
  if (!current || isWatched(current)) return;
  // Nothing is watching: stop the server's work for this topic, and DROP the
  // cached value. Keeping it would let a revisit of the same scope — root →
  // repo → root, where the topic string matches while the data has moved —
  // render the earlier visit's answer for the frame before the new snapshot
  // lands. A topic nobody watches has no current value.
  send({ t: 'unsubscribe', topics: [topic] });
  current.data = null;
  current.stale = false;
  current.seq = -1;
  refreshWanted();
}

/** Shared by both subscribe paths: ask for a topic the open socket lacks. */
function requestTopic(topic: string, entry: TopicEntry): void {
  connectIfNeeded();
  // Already connected: ask for this topic now. On a fresh dial the open handler
  // subscribes the whole live set instead.
  if (currentStatus() === 'open' && entry.seq === -1) send({ t: 'subscribe', topics: [topic] });
}

export const realtimeClient: RealtimeClient = {
  subscribe(topic, listener) {
    const entry = entryFor(topic);
    entry.listeners.add(listener);
    requestTopic(topic, entry);
    return () => {
      const current = topics().topics.get(topic);
      if (!current) return;
      current.listeners.delete(listener);
      releaseTopic(topic);
    };
  },

  subscribeFrames(topic, listener) {
    const entry = entryFor(topic);
    entry.frameListeners.add(listener);
    requestTopic(topic, entry);
    return () => {
      const current = topics().topics.get(topic);
      if (!current) return;
      current.frameListeners.delete(listener);
      releaseTopic(topic);
    };
  },

  read<T>(topic: string): T | null {
    const entry = topics().topics.get(topic);
    return entry && entry.data !== null ? (entry.data as T) : null;
  },

  isStale(topic) {
    return topics().topics.get(topic)?.stale ?? false;
  },

  refresh(topic) {
    const entry = entryFor(topic);
    entry.resyncing = false;
    requestResync(topic);
    if (currentStatus() !== 'open') {
      connectIfNeeded();
      send({ t: 'subscribe', topics: [topic] });
    }
  },

  onStatus: onStatusChange,

  status: currentStatus,

  setSocketConstructor,
};

/** Test seam: drop every topic and the connection. */
export function resetRealtimeClient(): void {
  globalThis.__kabmoRealtimeTopics = undefined;
  resetConnection();
}
