/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * What the omp child reports about the model it is actually serving with, and
 * the `get_state` probe that asks it.
 *
 * Split from the session wrapper so `manager.ts` stays under the repo's
 * per-file size ceiling; the wrapper keeps a one-line `syncRunModel` delegate
 * because the frame fold's host contract names that method.
 */

import type { RpcProcess } from '@/server/lib/omp/rpc/process';
import { GET_STATE_TIMEOUT_MS, type RpcSessionState } from '@/server/lib/omp/rpc/constants';
import { markStreamModel, type SessionRunModel } from '@/shared/lib/omp/session/stream-state.server';

/** Wrapper fields this probe reads and rewrites. */
export interface RunModelHost {
  runModel: SessionRunModel | null;
  readonly sessionId: string;
  readonly proc: RpcProcess;
}

/**
 * Re-read the model the child is ACTUALLY serving with, and rename the live
 * run row to match.
 *
 * omp's `model_changed` frame carries no payload, so this is the only way to
 * learn what it switched to: a retry under a fallback chain
 * (`retry.fallbackChains`) can swap the model MID-RUN, and the row the
 * sidebar and the generating indicator name the run by would otherwise keep
 * the pre-fallback model for the rest of the turn — reporting a provider the
 * answer did not come from.
 *
 * The probe is bounded: omp answers RPC handlers one at a time, so a parked
 * ask/approval dialog queues `get_state` behind it and an unbounded await would
 * never settle (the same reason `isBusy` counts pending dialogs).
 *
 * The write is deliberately live-only (`markStreamModel`): a fallback landing
 * on the run's last frame must not resurrect a `stream` row.
 */
export function syncRunModel(host: RunModelHost): void {
  void host.proc
    .sendCommand<RpcSessionState>({ type: 'get_state' }, GET_STATE_TIMEOUT_MS)
    .then((state) => {
      if (!state.model) return;
      const next = { provider: state.model.provider, modelId: state.model.id };
      const changed = host.runModel?.provider !== next.provider || host.runModel?.modelId !== next.modelId;
      host.runModel = next;
      if (changed && host.sessionId) void markStreamModel(host.sessionId, next);
    })
    .catch(() => {
      // A state read that fails (destroyed child, timeout) leaves the last
      // known model in place: the indicator keeps naming something true
      // rather than blanking mid-run.
    });
}
