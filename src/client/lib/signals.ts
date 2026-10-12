/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The client-only signals the chat, the sidebar and the composer hand each
 * other: the text a session row should show until omp's own title lands, a
 * rename, and a chamber-mode marker.
 *
 * A module bus rather than window events, for the reason the subagent frames
 * are: the payload is already scoped (a session id, a marker) and the consumers
 * are a known handful of hooks, so advertising the contract to the whole page
 * only made it harder to find who listened. Nothing here crosses the network —
 * the server's own state travels on the realtime topics.
 *
 * There is deliberately NO signal for a session's run state. The `stream` row
 * in `session_stream_state` is the single source of a run in flight (it rides
 * the `sidebar:status` topic), so a client-side mark could only ever ADD a
 * second answer — and one the client owns the lifecycle of, which is what left
 * a spinner turning after the run had ended.
 */

export type ClientSignalName =
  /** Seed a session row's title from the text the user just sent. */
  | 'session-title-hint'
  /** A session was renamed (this tab), so the navbar follows without a refetch. */
  | 'session-renamed'
  /** A chamber-mode notice marker parsed out of a frame. */
  | 'chamber-mode';

/** One signal's payload, keyed by the signal that carries it. */
export interface ClientSignalPayloads {
  'session-title-hint': { sessionId: string; title: string };
  'session-renamed': { sessionId: string; title: string };
  'chamber-mode': { sessionId?: string; marker?: unknown };
}

type Listener<N extends ClientSignalName> = (payload: ClientSignalPayloads[N]) => void;

const listeners: { [N in ClientSignalName]: Set<Listener<N>> } = {
  'session-title-hint': new Set(),
  'session-renamed': new Set(),
  'chamber-mode': new Set(),
};

/** Subscribe to one signal. Returns the unsubscribe. */
export function subscribeClientSignal<N extends ClientSignalName>(
  name: N,
  listener: Listener<N>,
): () => void {
  listeners[name].add(listener);
  return () => listeners[name].delete(listener);
}

/**
 * Publish one signal. A throwing listener never stops the others: this sits on
 * the send path and on the frame fold, so it must not be able to break the
 * action it reports on.
 */
export function publishClientSignal<N extends ClientSignalName>(
  name: N,
  payload: ClientSignalPayloads[N],
): void {
  for (const listener of [...listeners[name]]) {
    try {
      (listener as Listener<N>)(payload);
    } catch {
      // Deliberately swallowed: see the module doc.
    }
  }
}
