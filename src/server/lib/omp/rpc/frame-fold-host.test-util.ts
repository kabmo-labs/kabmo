/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The host the frame-fold tests drive.
 *
 * Shared by `frame-fold.test.ts` (when a trigger fires) and
 * `frame-fold-frames.test.ts` (what a frame does to the session's row and
 * caches) so the two cannot disagree about what a default host looks like —
 * a second copy would drift the moment a field is added to `SessionFrameHost`.
 *
 * No session id by default, so a fold that would reach the settings database
 * returns first and the tests stay pure.
 */

import type { SessionFrameHost } from '@/server/lib/omp/rpc/frame-fold';
import { ModeMirror } from '@/server/lib/omp/rpc/mode-mirror';

export function makeHost(overrides: Partial<SessionFrameHost> = {}): SessionFrameHost {
  return {
    sessionId: '',
    autoTitleWindowUntil: 0,
    autoTitleClaims: 0,
    autoTitleDispatch: null,
    autoTitlePending: true,
    autoTitleRequested: false,
    promptRunning: false,
    streaming: false,
    compacting: false,
    awaitingAgentStart: false,
    awaitingAgentStartDeadline: 0,
    continuationGraceUntil: 0,
    proc: { sendCommand: async () => undefined as never },
    emit() {},
    trackUiDialog() {},
    observeSubagent() {},
    syncRunModel() {},
    modeMirror: new ModeMirror(),
    isAlive: () => true,
    isBusy: () => false,
    send: async () => undefined,
    ...overrides,
  };
}
