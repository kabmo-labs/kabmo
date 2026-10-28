/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The topic registry: which topics exist, how each produces its snapshot, and
 * the named publishers a producer calls instead of knowing about the hub.
 *
 * Split from `hub.server.ts` (which owns the delivery mechanics) so this file
 * stays about WHAT is served and that one stays about HOW. Every resolver is
 * read-only by contract — subscribing must never spawn an omp child for a
 * session nobody is driving (see the plan's server-side invariants).
 */

import {
  TOPIC_MODELS,
  TOPIC_PANELS,
  TOPIC_SCHEDULE,
  TOPIC_SIDEBAR,
  TOPIC_SIDEBAR_ACTIVITY,
  TOPIC_SIDEBAR_STATUS,
  TOPIC_USAGE,
  TOPIC_WAITING,
  isValidTopic,
  reposTopic,
  sessionTopic,
} from '@/shared/lib/realtime/protocol';
import { getRealtimeHub, registerTopics, type TopicDescriptor } from '@/server/lib/realtime/hub.server';
import { onRealtimeSignal } from '@/server/lib/realtime/signals.server';
import { invalidateOmpSidebarData } from '@/server/lib/omp/session/reader';
import { loadSidebarStatus, loadSidebarStructure } from '@/server/lib/omp/session/sidebar-data.server';
import { loadSidebarActivity } from '@/server/lib/omp/session/sidebar-activity.server';
import { EXACT_TOPICS, descriptorFor, isKnownTopicName } from '@/server/lib/realtime/topics/catalog.server';

declare global {
  // eslint-disable-next-line no-var
  var __kabmoRealtimeTopicsReady: boolean | undefined;
}

/**
 * Window a burst of change signals collapses into one publish. A single run
 * writes the stream status several times within milliseconds, and each write
 * would otherwise cost a status read plus a fan-out to every tab.
 */
const PUBLISH_COALESCE_MS = 120;

/**
 * Build the descriptor map the hub serves.
 *
 * Scoped topics are resolved LAZILY through a proxy map: the hub asks for a
 * topic's descriptor by name at subscribe time, and building every possible
 * `session:<uuid>` up front is impossible. The proxy answers `get`/`has` for any
 * known-prefix name, which are the only operations the hub performs.
 */
function buildDescriptors(): Map<string, TopicDescriptor> {
  const map = new Map(EXACT_TOPICS);
  return new Proxy(map, {
    get(target, property, receiver) {
      if (property === 'get') {
        return (topic: string) => target.get(topic) ?? (isKnownTopicName(topic) ? descriptorFor(topic) : undefined);
      }
      if (property === 'has') {
        return (topic: string) => target.has(topic) || isKnownTopicName(topic);
      }
      return Reflect.get(target, property, receiver);
    },
  });
}

/**
 * Register the topic set with the hub. Idempotent: a `bun --hot` reload
 * re-registers the same map rather than accumulating descriptors, and a second
 * call from the route's boot path is a no-op.
 */
export function initRealtimeTopics(): void {
  if (globalThis.__kabmoRealtimeTopicsReady) return;
  globalThis.__kabmoRealtimeTopicsReady = true;
  registerTopics(buildDescriptors());
  onRealtimeSignal(({ signal, sessionId, root }) => {
    if (signal === 'stream-status') publishSidebarStatus();
    else if (signal === 'sidebar-structure') publishSidebarStructure();
    else if (signal === 'sidebar-activity') publishSidebarActivity();
    else if (signal === 'session-attached' && sessionId) publishSessionState(sessionId);
    else if (signal === 'schedule-changed') publishTopic(TOPIC_SCHEDULE);
    else if (signal === 'panels-changed') publishTopic(TOPIC_PANELS);
    else if (signal === 'models-changed') {
      publishTopic(TOPIC_MODELS);
      // A provider write is also a CREDENTIAL write (connect/disconnect, a new
      // models.yml entry, a key edit), and the Usage surfaces list exactly the
      // credentialed providers. Without this the `usage` topic had no producer
      // at all, so a key added in another tab never reached an open panel. The
      // probe it re-runs is cached for a minute, so a burst of writes costs one
      // resolve.
      publishTopic(TOPIC_USAGE);
    }
    else if (signal === 'workspace-dirty') republishWatchedWorkspaceTopics();
    else if (signal === 'session-data-dirty' && sessionId) republishSessionDataTopics(sessionId);
    else if (signal === 'repos-scanned' && root) publishTopic(reposTopic(root));
    else if (signal === 'waiting-changed') publishTopic(TOPIC_WAITING);
  });
}

/** Whether this hub serves `topic`. Consulted before a subscribe is accepted. */
export function isKnownTopic(topic: string): boolean {
  return isValidTopic(topic) && getRealtimeHub().knows(topic);
}

/**
 * Re-resolve a topic whose producer just changed it, coalescing a burst.
 *
 * Used by the GLOBAL topics and by the workspace families: their payloads are
 * produced on demand, so a write is reported by re-resolving rather than by
 * streaming the change.
 *
 * The resolve goes through the HUB's own descriptor table, never this module's
 * `EXACT_TOPICS`/`descriptorFor`: the registry is what the hub was actually
 * given, and re-resolving from a private copy answered from a different map —
 * a `git:`/`fs:`/`repos:`/`wiki:` name is absent from `EXACT_TOPICS`, so the
 * lookup returned `null` and every subscriber's panel was BLANKED instead of
 * re-read. (In a test with its own topic set it also ran the production
 * resolver, which is how that surfaced.)
 */
export function publishTopic(topic: string): void {
  schedulePublish(topic, () => getRealtimeHub().resolve(topic));
}

/**
 * Republish every workspace topic that someone is watching.
 *
 * A turn boundary means the working tree and the session's usage may both have
 * moved, but the topics are scoped to trees this process does not know about
 * until it is asked — so the SUBSCRIBED set is the list, not a guess. Only
 * watched topics are re-read, so a tab with no git panel pays nothing.
 */
export function republishWatchedWorkspaceTopics(): void {
  for (const topic of getRealtimeHub().activeTopics()) {
    if (topic.startsWith('git:') || topic.startsWith('fs:')) publishTopic(topic);
  }
}

/**
 * Republish every watched DATA topic of one session (`todos`, `plan`,
 * `telemetry`, `queue`).
 *
 * The list is the SUBSCRIBED set, not all four: a tab that never opened the
 * todo panel pays nothing, and the topic's own resolver is the only reader that
 * knows how expensive it is (`todos` parses a whole transcript, `telemetry`
 * scans it). Publishing unconditionally would run both for every turn of every
 * session, which is the polling this channel replaced.
 */
export function republishSessionDataTopics(sessionId: string): void {
  const prefix = `session:${sessionId}:`;
  for (const topic of getRealtimeHub().activeTopics()) {
    if (topic.startsWith(prefix)) publishTopic(topic);
  }
}

/**
 * A session's live state changed outside its own frame stream — it was just
 * spawned, adopted, or its run settled.
 *
 * REBINDS the topic as well as re-snapshotting it. `attach` binds a topic to
 * its source once per subscription, and this is where that source is replaced:
 * a subscriber watching when the child was idle-reaped, respawned for a mode
 * change, or restarted after a crash still holds its subscription and would
 * otherwise get snapshots and then silence — a live-looking run with no frames
 * until the page reloads and re-subscribes. Also covers the reverse order: a
 * topic subscribed before any child existed bound the peer-relay probe, which
 * finds no owner for a session this process is about to own.
 */
export function publishSessionState(sessionId: string): void {
  const topic = sessionTopic(sessionId);
  getRealtimeHub().rebind(topic);
  getRealtimeHub().republishSnapshot(topic);
}

// ---------------------------------------------------------------------------
// Publishers — the names a producer calls
// ---------------------------------------------------------------------------

/**
 * Coalescing and dedupe state, on `globalThis` for the reason the hub is: a
 * hot reload must not leave a pending timer writing into a discarded map.
 */
interface PublishState {
  timers: Map<string, number | NodeJS.Timeout>;
  /** JSON of the last payload published per topic, to skip no-op republishes. */
  last: Map<string, string>;
}

declare global {
  // eslint-disable-next-line no-var
  var __kabmoRealtimePublish: PublishState | undefined;
}

function publishState(): PublishState {
  return (globalThis.__kabmoRealtimePublish ??= { timers: new Map(), last: new Map() });
}

/**
 * Publish a topic's freshly produced payload, coalescing a burst into one send
 * and skipping a payload identical to the last one.
 *
 * Both halves are load-bearing. A single run writes the stream status several
 * times (`turn_start`, `agent_start`, `message_start`, `message_end`), and each
 * write would otherwise cost a full status read plus a fan-out to every tab —
 * more work than the 8s poll this replaces. Dedupe catches the common case
 * where the row did not actually move (the status was already `stream`).
 */
export function schedulePublish(topic: string, produce: () => Promise<unknown>): void {
  const state = publishState();
  if (state.timers.has(topic)) return;
  state.timers.set(
    topic,
    setTimeout(() => {
      state.timers.delete(topic);
      const hub = getRealtimeHub();
      if (!hub.knows(topic)) return;
      void produce().then(
        (payload) => {
          const encoded = JSON.stringify(payload);
          if (state.last.get(topic) === encoded) return;
          state.last.set(topic, encoded);
          hub.publish(topic, payload);
        },
        () => {
          // A failed read leaves subscribers on their last good value; the next
          // signal republishes. Publishing an empty payload would blank every
          // spinner in every tab over a transient database hiccup.
        },
      );
    }, PUBLISH_COALESCE_MS),
  );
}

/**
 * A sidebar session's volatile fields changed (a run started, ended, aborted,
 * or the session became blocked on a dialog).
 *
 * Publishes the whole status map rather than one entry: it is one SQLite read
 * and a small object, and a per-entry delta would need the client to merge
 * removals — a session that finished has its badge CLEARED when opened, which
 * is a deletion, not a value.
 */
export function publishSidebarStatus(): void {
  schedulePublish(TOPIC_SIDEBAR_STATUS, loadSidebarStatus);
}

/**
 * A RUNNING session's transcript grew: republish its activity stamps.
 *
 * Called per tool call (see `handleToolExecutionEnd`), so it must never be the
 * structure publish: that one invalidates the discovery scan and re-serializes
 * every folder and session. This payload carries one ISO string per live run
 * and re-reads nothing but those files' own summaries (each memoized on
 * `(size, mtimeMs)`, measured 0.1 ms on a cache miss).
 */
export function publishSidebarActivity(): void {
  schedulePublish(TOPIC_SIDEBAR_ACTIVITY, loadSidebarActivity);
}

/**
 * The sidebar's STRUCTURE changed: a session was created, deleted, renamed, a
 * folder was added or removed, or a JSONL grew a new session.
 *
 * Separate from `publishSidebarStatus` because producing it runs a full omp
 * discovery scan — so it is published on structure events only, never on a
 * status flip.
 *
 * The scan cache is dropped FIRST, and that is not an optimisation: the signal
 * says something structural moved, while the discovery scan is TTL'd (4s) and
 * would otherwise answer with the snapshot taken before the change — a new
 * session would not appear in the very publish that announced it.
 */
export function publishSidebarStructure(): void {
  invalidateOmpSidebarData();
  schedulePublish(TOPIC_SIDEBAR, loadSidebarStructure);
}
