/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Wire contract for the unified realtime socket — the one channel every
 * server-originated event travels on.
 *
 * Shared by both ends (like `workspace/terminal/protocol.ts`) so the frame
 * shapes cannot drift. The client half lives in `client.ts`, the server half in
 * `@/server/lib/realtime/hub.server.ts`.
 *
 * A topic names a RESOURCE a client reads, not a window event. The protocol is
 * snapshot-then-delta: `subscribe` answers with a full `snapshot`, and later
 * changes arrive as `delta` frames carrying the topic's new value.
 * `snapshot` resets the client's sequence baseline, which is what makes a
 * resubscribe (after a reconnect) a complete repair rather than a guess.
 *
 * Scoped topics join their parts with `TOPIC_SCOPE_SEPARATOR` — a NUL, the same
 * convention `root\0repo` already uses for scope tagging. JSON encodes it as
 * `\u0000`, so it survives the wire unchanged.
 */

import { isRecord } from '@/shared/lib/util/guards';

/** Joins a scoped topic's parts. Never appears in a path, so no escaping. */
export const TOPIC_SCOPE_SEPARATOR = '\u0000';

/** Bound on one topic string. A session id is 36 chars; a scoped path is longer. */
export const MAX_TOPIC_LENGTH = 512;

/** Bound on one frame's topic list, so a malformed frame cannot fan out. */
export const MAX_TOPICS_PER_FRAME = 64;

// ---------------------------------------------------------------------------
// Topic names
// ---------------------------------------------------------------------------

/** Sidebar structure: folders and their sessions, without volatile fields. */
export const TOPIC_SIDEBAR = 'sidebar';

/** Sidebar volatile fields only (`streamStatus`, `awaitingInput`, `runModel`).
 *  Split from `sidebar` because it changes on every stream-status write while
 *  the structure needs a JSONL scan to produce. */
export const TOPIC_SIDEBAR_STATUS = 'sidebar:status';

/**
 * The last-activity stamp of each session with a run IN FLIGHT, keyed by id.
 *
 * Split from `sidebar` for the same reason `sidebar:status` is, but the cost
 * difference is far larger: a transcript grows on every tool call, so this
 * changes per tool call while the structure is a 216 KB payload over 731
 * sessions (measured on the author's install) that must be re-scanned to
 * produce. Only a RUNNING session's stamp can move between turn boundaries, so
 * only those are carried — the payload is one ISO string per live run
 * (measured: 87 bytes for one), against 216 KB for the whole list.
 *
 * The structure remains the authority for every other row; this only ever
 * ADVANCES a stamp the structure already carries (see `applySidebarActivity`).
 */
export const TOPIC_SIDEBAR_ACTIVITY = 'sidebar:activity';

/** One session's live conversation: agent frames, queue and modes. */
export function sessionTopic(sessionId: string): string {
  return `session:${sessionId}`;
}

/** One session's todo snapshot. */
export function sessionTodosTopic(sessionId: string): string {
  return `session:${sessionId}:todos`;
}

/** One session's plan artifact listing. */
export function sessionPlanTopic(sessionId: string): string {
  return `session:${sessionId}:plan`;
}

/** One session's context telemetry. */
export function sessionTelemetryTopic(sessionId: string): string {
  return `session:${sessionId}:telemetry`;
}

/** One session's follow-up queue. */
export function sessionQueueTopic(sessionId: string): string {
  return `session:${sessionId}:queue`;
}

/** A working tree's git status. `scope` is `root\0repo`, the panel's own key. */
export function gitTopic(scope: string): string {
  return `git:${scope}`;
}

/** A working tree's file listing. */
export function fsTopic(scope: string): string {
  return `fs:${scope}`;
}

/** Nested-repository discovery for one workspace root. */
export function reposTopic(root: string): string {
  return `repos:${root}`;
}

/** A wiki's tree, scoped by `root\0repo`. */
export function wikiTopic(scope: string): string {
  return `wiki:${scope}`;
}

/** One session's side-question frames. */
export function btwTopic(sessionId: string): string {
  return `btw:${sessionId}`;
}

/** Provider usage/quota. */
export const TOPIC_USAGE = 'usage';

/** Scheduled tasks. */
export const TOPIC_SCHEDULE = 'schedule';

/**
 * Prompts held until another session finishes.
 *
 * A global topic rather than per-session: the row belongs to the session that
 * has NOT been created yet, and the dependency it names is a different session
 * again. Both the sidebar (to draw the waiting row) and the composer (to offer
 * the dependencies) read it.
 */
export const TOPIC_WAITING = 'waiting';

/** Installed panel plugins and their catalog. */
export const TOPIC_PANELS = 'panels';

/** The model catalog. */
export const TOPIC_MODELS = 'models';

// ---------------------------------------------------------------------------
// Frames
// ---------------------------------------------------------------------------

export interface RealtimeSubscribeFrame {
  t: 'subscribe';
  topics: string[];
}

export interface RealtimeUnsubscribeFrame {
  t: 'unsubscribe';
  topics: string[];
}

/** Ask for a fresh snapshot — sent after a detected gap, or on a manual refresh. */
export interface RealtimeResyncFrame {
  t: 'resync';
  topics: string[];
}

/** Application-level liveness probe; the transport also sends protocol pings. */
export interface RealtimePingFrame {
  t: 'ping';
  id: number;
}

export type RealtimeClientFrame =
  | RealtimeSubscribeFrame
  | RealtimeUnsubscribeFrame
  | RealtimeResyncFrame
  | RealtimePingFrame;

/** A topic's full value. Resets the receiver's sequence baseline for the topic. */
export interface RealtimeSnapshotFrame {
  t: 'snapshot';
  topic: string;
  seq: number;
  payload: unknown;
}

/** A topic's new value. `seq` is contiguous per topic, starting after the snapshot. */
export interface RealtimeDeltaFrame {
  t: 'delta';
  topic: string;
  seq: number;
  payload: unknown;
}

export interface RealtimePongFrame {
  t: 'pong';
  id: number;
}

/**
 * The error codes the server actually sends.
 *
 * Deliberately only these two: a malformed client frame is IGNORED rather than
 * answered (see `decodeClientFrame`), so one bad frame cannot cost a tab its
 * whole realtime channel, and there is no producer for a `bad_frame` or
 * `too_many_topics` reply. A code with no producer is a promise the protocol
 * does not keep.
 */
export type RealtimeErrorCode = 'unknown_topic' | 'snapshot_failed';

export interface RealtimeErrorFrame {
  t: 'error';
  code: RealtimeErrorCode;
  message: string;
  /** The topic the error is about, when it is about one. */
  topic?: string;
}

export type RealtimeServerFrame =
  | RealtimeSnapshotFrame
  | RealtimeDeltaFrame
  | RealtimePongFrame
  | RealtimeErrorFrame;

// ---------------------------------------------------------------------------
// Codecs
// ---------------------------------------------------------------------------

export function encodeClientFrame(frame: RealtimeClientFrame): string {
  return JSON.stringify(frame);
}

export function encodeServerFrame(frame: RealtimeServerFrame): string {
  return JSON.stringify(frame);
}

function tryParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Read a topic list, bounded and filtered to valid names. Null when malformed. */
function readTopics(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  if (value.length > MAX_TOPICS_PER_FRAME) return null;
  const topics: string[] = [];
  for (const entry of value) {
    if (!isValidTopic(entry)) return null;
    topics.push(entry);
  }
  return topics;
}

/**
 * Decode a control frame from either a parsed object or raw JSON text. Null for
 * anything unrecognized — a client that sends junk is ignored rather than
 * disconnected, so one bad frame cannot cost a tab its whole realtime channel.
 *
 * Both input shapes are accepted because Elysia's Bun adapter hands `message` a
 * JSON frame already PARSED (measured on 1.4.30: a `{t:'subscribe'}` sent as
 * text arrives as an object). The terminal socket's decoder takes the same
 * shape for the same reason; rejecting a non-string here silently dropped every
 * inbound frame.
 */
export function decodeClientFrame(raw: unknown): RealtimeClientFrame | null {
  const value = typeof raw === 'string' ? tryParse(raw) : raw;
  if (!isRecord(value)) return null;

  if (value.t === 'ping') {
    return typeof value.id === 'number' && Number.isFinite(value.id) ? { t: 'ping', id: value.id } : null;
  }

  if (value.t === 'subscribe' || value.t === 'unsubscribe' || value.t === 'resync') {
    const topics = readTopics(value.topics);
    return topics ? { t: value.t, topics } : null;
  }

  return null;
}

export function decodeServerFrame(raw: string): RealtimeServerFrame | null {
  const value = tryParse(raw);
  if (!isRecord(value)) return null;

  if (value.t === 'pong') {
    return typeof value.id === 'number' ? { t: 'pong', id: value.id } : null;
  }

  if (value.t === 'snapshot' || value.t === 'delta') {
    if (typeof value.topic !== 'string' || typeof value.seq !== 'number') return null;
    return { t: value.t, topic: value.topic, seq: value.seq, payload: value.payload };
  }

  if (value.t === 'error') {
    if (typeof value.code !== 'string' || typeof value.message !== 'string') return null;
    return {
      t: 'error',
      code: value.code as RealtimeErrorCode,
      message: value.message,
      ...(typeof value.topic === 'string' ? { topic: value.topic } : {}),
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Validation and URL
// ---------------------------------------------------------------------------

/**
 * Whether `value` is a topic this protocol will carry.
 *
 * Deliberately structural: the KIND decides what a topic means and whether the
 * caller may read it (a `git:` scope has to resolve inside a workspace), and
 * that check belongs to the resolver. This only rejects what could not be a
 * topic at all — empty, over-long, or carrying a control character other than
 * the scope separator.
 */
export function isValidTopic(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (value.length === 0 || value.length > MAX_TOPIC_LENGTH) return false;
  // eslint-disable-next-line no-control-regex
  return !/[\u0001-\u001f\u007f]/.test(value);
}

/** WebSocket endpoint for the unified channel. Browser-only. */
export function realtimeSocketUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/api/realtime/ws`;
}
