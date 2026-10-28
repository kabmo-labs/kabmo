/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Handing a Kabmo mode signal to whoever listens for it.
 *
 * Two producers reach the same consumer: the extension's notice markers (which
 * the fold parses out of `extension_ui_request` frames) and Kabmo's own
 * auditor frames (`goal_evaluating`). Both are composer state rather than
 * conversation, so neither goes through the timeline's callbacks — they are
 * re-dispatched as a scoped window event, the same shape the subagent frames
 * use, and the mode hook subscribes once.
 */

import { publishClientSignal } from '@/client/lib/signals';

export interface KabmoModeSignal {
  marker: string;
  payload: Record<string, unknown>;
}

/** The Kabmo-mode signal name, for a consumer that subscribes. */
export const KABMO_MODE_SIGNAL = 'kabmo-mode' as const;

export function emitKabmoModeSignal(sessionId: string | undefined, signal: KabmoModeSignal): void {
  publishClientSignal(KABMO_MODE_SIGNAL, { sessionId, marker: signal });
}

/** @deprecated Use `KabmoModeSignal`. */
export type ChamberModeSignal = KabmoModeSignal;

/** @deprecated Use `emitKabmoModeSignal`. */
export const emitChamberModeSignal = emitKabmoModeSignal;
