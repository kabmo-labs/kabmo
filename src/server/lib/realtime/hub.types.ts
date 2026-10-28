/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The realtime hub's contracts: the descriptor a topic is wired with, the
 * connection the transport hands it, and the surface publishers and subscribers
 * use.
 *
 * Split from `hub.server.ts` because the runtime there sits on the repo's
 * 350-line ceiling, and these are the shapes two other modules (the WS route and
 * the topic registry) need without pulling the implementation in.
 */

import type { RealtimeServerFrame } from '@/shared/lib/realtime/protocol';

/** Resolves a topic to its current value. Rejects for a topic that cannot be read. */
export type TopicResolver = (topic: string) => Promise<unknown>;

/**
 * A topic's server-side wiring. `attach` runs when the FIRST connection
 * subscribes and its cleanup when the LAST one leaves — the only place a topic
 * binds to a per-session source (an omp child's fanout, a BTW registry) without
 * working for nobody, which is what makes "no subscribers, no work" true for a
 * topic whose data is pushed rather than read.
 */
export interface TopicDescriptor {
  resolve: TopicResolver;
  /** Bind to the underlying source. Returns the cleanup that unbinds it. */
  attach?: (topic: string) => (() => void) | void;
}

/** One connected client. `send` is the transport's own writer. */
export interface RealtimeConnection {
  readonly topics: Set<string>;
  /** Topics whose snapshot this connection has already received. */
  readonly snapshotted: Set<string>;
  send: (frame: RealtimeServerFrame) => void;
  closed: boolean;
}

export interface PendingDelta {
  seq: number;
  payload: unknown;
}

export interface TopicEntry {
  /** Last published sequence number. Contiguous per topic. */
  seq: number;
  subscribers: Set<RealtimeConnection>;
  /** Cleanup for the descriptor's `attach`, held while subscribers exist. */
  detach: (() => void) | null;
  /** Deltas published while a resolve is in flight, for the awaiting connections. */
  buffer: PendingDelta[];
  /** The in-flight resolve, shared by every connection that joined it. */
  resolve: Promise<{ ok: true; payload: unknown } | { ok: false; error: unknown }> | null;
  /** `seq` at the moment the current resolve started. */
  baseSeq: number;
  /** A resolve outran its buffer; awaiting connections need a fresh one. */
  overflowed: boolean;
}

export interface RealtimeHub {
  /** The topics this hub can serve. An unknown topic is refused, not ignored. */
  knows: (topic: string) => boolean;
  /**
   * The CURRENT value of `topic`, through the descriptor this hub was
   * registered with.
   *
   * Publishers that report a write by re-resolving must go through here rather
   * than their own module's descriptor table: a test (or a future second
   * registry) registers its own descriptors, and re-resolving from a private
   * copy would answer from — or silently blank — a topic the hub never served.
   */
  resolve: (topic: string) => Promise<unknown>;
  subscribe: (connection: RealtimeConnection, topic: string) => void;
  unsubscribe: (connection: RealtimeConnection, topic: string) => void;
  /** Drop every subscription of a closed connection. */
  release: (connection: RealtimeConnection) => void;
  /** Publish a topic's new value to its subscribers. */
  publish: (topic: string, payload: unknown) => void;
  /**
   * Re-resolve `topic` and send the result as a fresh `snapshot`, resetting
   * every subscriber's sequence baseline.
   *
   * For the case a delta cannot express: a topic whose SOURCE did not exist
   * when it was first subscribed (a session with no omp child yet). The
   * resolver is the same one `subscribe` uses, so the two can never disagree.
   */
  republishSnapshot: (topic: string) => void;
  /**
   * Re-run a topic's `attach` under its live subscribers.
   *
   * `attach` binds a topic to its SOURCE once per subscription, so a source
   * that is REPLACED while the subscription stands (a session's omp child
   * respawned by the idle reaper, a mode reconcile or a crash) leaves the topic
   * wired to the old one: the subscriber receives snapshots and then silence.
   * Called wherever the source is known to have been replaced; a no-op with no
   * subscribers, so a topic nobody watches never holds a source open.
   */
  rebind: (topic: string) => void;
  /**
   * Send an EXTERNALLY produced snapshot to every subscriber of `topic`,
   * resetting their baselines.
   *
   * For the peer bridge: an instance that does not own a session relays the
   * owner's frames, and the owner's own snapshot must become this instance's
   * subscribers' baseline — the local resolver cannot produce it (the child is
   * not here).
   */
  publishSnapshot: (topic: string, payload: unknown) => void;
  /** Test seam: the sequence number a topic is at. */
  sequenceOf: (topic: string) => number;
  /** Every topic with at least one subscriber, in subscription order. */
  activeTopics: () => string[];
}

export interface HubState {
  topics: Map<string, TopicEntry>;
  descriptors: Map<string, TopicDescriptor>;
}
