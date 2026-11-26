/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * What any module may ask about the sessions THIS process is running, without
 * holding the wrapper.
 *
 * The registry itself owns the map and the spawn locks, and it always will: it
 * constructs the omp wrapper, claims harness ownership and reaps dead children.
 * But the console's readers — the sidebar's status map, its activity stamps, the
 * ACP telemetry probe — only need four facts about a session, and asking for
 * them through the concrete wrapper made every one of those readers a part of the
 * app. This module is that list of facts.
 *
 * The registry registers a *reader* that walks its own map, so there is one
 * source of truth and no second copy to drift. Both slots live on `globalThis`
 * for the reason the signal registry does: `bun --hot` re-evaluates this module
 * while the registry's one-shot registration does not re-run.
 */

/** The facts a reader may ask for. */
export interface LiveSessionFacts {
  /** The id the registry keys this session by. */
  sessionId: string;
  /** The harness that claimed it (`omp-rpc` for anything unclaimed). */
  harness: string;
  /**
   * A run is in flight. Deliberately the SESSION's own answer, not a stream row:
   * the sidebar needs it while the row is still being written.
   */
  running: boolean;
  /** Parked on a dialog only the user can release. */
  awaitingInput: boolean;
}

type Reads = () => LiveSessionFacts[];

/**
 * The reconcile sweep a status read triggers: a row this process owns with no
 * run behind it needs the OWNER's view of the child, which only a `get_state`
 * can give. Registered as a side effect rather than returned as data because the
 * sweep is fire-and-forget and must not make a read wait on a probe.
 */
type Reconciler = () => void;

declare global {
  // eslint-disable-next-line no-var
  var __kabmoLiveSessionReads: Reads | undefined;
  // eslint-disable-next-line no-var
  var __kabmoLiveSessionReconcile: Reconciler | undefined;
}

/** Register the registry's own reads. */
export function registerLiveSessionReads(reads: Reads | null): void {
  globalThis.__kabmoLiveSessionReads = reads ?? undefined;
}

/** Register the reconcile sweep. */
export function registerLiveSessionReconcile(reconcile: Reconciler | null): void {
  globalThis.__kabmoLiveSessionReconcile = reconcile ?? undefined;
}

/** Every live session's facts. Empty when nothing registered (a test, a worker). */
export function liveSessionFacts(): LiveSessionFacts[] {
  return globalThis.__kabmoLiveSessionReads?.() ?? [];
}

/** One session's facts, or undefined when it is not live here. */
export function liveSessionFactsFor(sessionId: string): LiveSessionFacts | undefined {
  return liveSessionFacts().find((facts) => facts.sessionId === sessionId);
}

/** Ids of sessions with a run in flight — the stream-row heal's input. */
export function liveRunSessionIds(): Set<string> {
  const ids = new Set<string>();
  for (const facts of liveSessionFacts()) {
    if (facts.running) ids.add(facts.sessionId);
  }
  return ids;
}

/** Ids of sessions parked on a dialog the user must answer. */
export function awaitingInputSessionIds(): string[] {
  return liveSessionFacts()
    .filter((facts) => facts.awaitingInput)
    .map((facts) => facts.sessionId);
}

/** Ask the owner to reconcile the rows it owns. Fire-and-forget. */
export function reconcileLiveSessions(): void {
  globalThis.__kabmoLiveSessionReconcile?.();
}

/**
 * "This session is parked on a dialog only the user can answer" — raised where
 * the dialog is seen, noticed by the feed that owns the banner. Registered for
 * the same reason as the reads above: the notifier needs the session title and
 * the notification store, which the frame path must not acquire.
 */
type AwaitingReporter = (sessionId: string) => void | Promise<void>;

declare global {
  // eslint-disable-next-line no-var
  var __kabmoAwaitingInputReporter: AwaitingReporter | undefined;
}

export function registerAwaitingInputReporter(reporter: AwaitingReporter | null): void {
  globalThis.__kabmoAwaitingInputReporter = reporter ?? undefined;
}

export function reportAwaitingInput(sessionId: string): void {
  void globalThis.__kabmoAwaitingInputReporter?.(sessionId);
}
