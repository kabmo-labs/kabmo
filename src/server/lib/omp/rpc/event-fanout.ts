/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Fan-out for one omp child's event stream.
 *
 * Split out of the session wrapper for the same reason `IdleReaper`,
 * `PendingUiDialogs` and `SubagentLiveness` were: the wrapper composes several
 * self-contained pieces, and this one owns exactly one rule — a throwing
 * subscriber must not starve the others. It sits on the frame path, so a
 * subscriber that throws (an SSE encode failure, a UI handler bug) would
 * otherwise abort the whole dispatch and silently drop every later listener.
 *
 * Insertion order is preserved, and unsubscribing is by identity, so a listener
 * added twice receives twice and each removal takes out one registration.
 */

import type { AgentEvent, EventListener } from '@/server/lib/omp/rpc/constants';

export class EventFanout {
  readonly #listeners: EventListener[] = [];

  emit(event: AgentEvent): void {
    for (const listener of this.#listeners) {
      try {
        listener(event);
      } catch {
        // Deliberately swallowed: see the module doc.
      }
    }
  }

  /** Register a listener; the returned function removes exactly that one. */
  on(listener: EventListener): () => void {
    this.#listeners.push(listener);
    return () => {
      const index = this.#listeners.indexOf(listener);
      if (index !== -1) this.#listeners.splice(index, 1);
    };
  }
}
