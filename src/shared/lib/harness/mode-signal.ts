/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Publishing "the agent changed its session mode/config".
 *
 * The fold sees `mode_changed` / `config_changed` frames; the composer's mode
 * dropdown owns the `/modes` read and cannot see frames. This one-hop signal
 * keeps the dropdown from polling: the frame is the event, and the consumer
 * re-reads the authoritative value once.
 */

import { publishClientSignal } from '@/client/lib/signals';

export function emitSessionModesChanged(sessionId: string | undefined): void {
  if (!sessionId) return;
  publishClientSignal('session-modes-changed', { sessionId });
}
