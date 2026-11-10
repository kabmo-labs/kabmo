/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The session's subscriber set, split out of `AcpSession` because it is a
 * transport-neutral detail: every adapter emits frames to the same listeners,
 * and one throwing subscriber must not starve the others.
 */

import type { AgentEvent } from '@/server/lib/omp/rpc/constants';

export class SessionListeners {
  private readonly listeners = new Set<(event: AgentEvent) => void>();

  add(listener: (event: AgentEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event: AgentEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // One throwing subscriber must not starve the others.
      }
    }
  }
}
