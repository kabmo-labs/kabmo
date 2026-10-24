/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Named signals a server module raises when something a realtime topic
 * describes has changed.
 *
 * The indirection exists to keep the dependency arrow pointing one way. The
 * modules that WRITE the state (`stream-state.server.ts`, `delete.server.ts`)
 * live below the realtime layer and must not import it — doing so would make
 * `topics.server.ts` → `sidebar-data.server.ts` → `stream-state.server.ts` →
 * `topics.server.ts` a cycle. They raise a signal instead, and the realtime
 * layer subscribes at init.
 *
 * This module deliberately imports nothing, so it can sit under any of them.
 */

export type RealtimeSignal =
  /** A session's stream status changed (a run opened, ended, or was aborted). */
  | 'stream-status'
  /** The sidebar's structure changed (a session or folder was added/removed). */
  | 'sidebar-structure'
  /**
   * A RUNNING session's transcript grew, so its last-activity stamp moved.
   *
   * Raised per tool call, which is the whole reason it is not
   * `sidebar-structure`: that payload is every folder and session (216 KB over
   * 731 sessions, measured), while only a running session's stamp can move
   * between turn boundaries. Republishing the structure here is what made a
   * phone's stream feel slow — one full list per tool call.
   */
  | 'sidebar-activity'
  /** An omp child for `sessionId` became reachable, or was torn down. */
  | 'session-attached'
  /** A scheduled task was created, edited, paused, deleted or fired. */
  | 'schedule-changed'
  /** A panel plugin was installed, removed or edited. */
  | 'panels-changed'
  /** The model catalog changed (a provider or model was written). */
  | 'models-changed'
  /**
   * A run's work may have changed files on disk or advanced its usage.
   *
   * Raised at a turn boundary rather than per tool: a run routinely edits
   * several files, and republishing a workspace listing per tool would re-run
   * `git status` and a directory read for every one of them.
   */
  | 'workspace-dirty'
  /**
   * A background nested-repo walk finished for one workspace root.
   *
   * The walk is started by a read (the `repos:` topic's own resolver), so
   * nothing writes it — the completion is the only moment the list becomes
   * final, and without this signal the client would have to poll for it.
   */
  | 'repos-scanned'
  /**
   * One session's DATA changed: its todo snapshot, plan artifacts, context
   * telemetry or follow-up queue.
   *
   * Raised at a turn boundary (a `todo` call commits inside the run, so the
   * transcript only tells the truth once the turn settles) and by every queue
   * write. Without it the four `session:<id>:<suffix>` topics were served as a
   * snapshot and then never moved — the panels rendered whatever existed when
   * they subscribed and only a reload showed the new state.
   */
  | 'session-data-dirty'
  /**
   * A waiting prompt was created, cancelled, dispatched or failed.
   *
   * Both halves read it: the server republishes the `waiting` topic, and the
   * client's dispatch watcher adopts the session a prompt became. Nothing else
   * reports a dispatch — no user action causes it, and the spawned session's own
   * transcript is seconds away.
   */
  | 'waiting-changed';

export interface RealtimeSignalEvent {
  signal: RealtimeSignal;
  /** The session a per-session signal is about. Absent for global signals. */
  sessionId?: string;
  /** The workspace root a root-scoped signal is about (`repos-scanned`). */
  root?: string;
}

type SignalListener = (event: RealtimeSignalEvent) => void;

const listeners = new Set<SignalListener>();

/** Subscribe to every signal. Returns an unsubscribe. */
export function onRealtimeSignal(listener: SignalListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Raise a signal. A throwing listener never stops the others: this sits on
 * write paths (a status flip inside a frame handler), so it must not be able
 * to break the write it is reporting on.
 */
export function emitRealtimeSignal(signal: RealtimeSignal, sessionId?: string, root?: string): void {
  const event: RealtimeSignalEvent =
    sessionId === undefined && root === undefined
      ? { signal }
      : { signal, ...(sessionId !== undefined ? { sessionId } : {}), ...(root !== undefined ? { root } : {}) };
  for (const listener of [...listeners]) {
    try {
      listener(event);
    } catch {
      // Deliberately swallowed: see the module doc.
    }
  }
}

/** Test seam. */
export function clearRealtimeSignalListeners(): void {
  listeners.clear();
}
