/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The fields a LIVE non-omp session adds to the chat payload.
 *
 * Split out of the loader so every branch that answers a session states these
 * once: the file-backed branch, the stored-row branch and the seed branch all
 * spread the same object, and a branch that forgot one of them is how a
 * reopened ACP chat named a model its agent never ran.
 */

import type { LiveHarnessModels } from '@/shared/types/harness';

/** What a LIVE non-omp session adds to the session payload: its resolved model,
 *  its thinking level, and the selector lists it published. */
export interface LiveSessionMeta {
  model?: { provider: string; modelId: string };
  thinkingLevel?: string;
  harness?: string;
  liveModels?: LiveHarnessModels;
}

/** Spread into the `session` payload so every branch states these fields once.
 *  `recorded` is the last run's model from `session_stream_state`, used only
 *  when no live session can answer. */
export function liveMetaFields(
  liveMeta: LiveSessionMeta | null,
  recorded?: { provider: string; modelId: string },
  recordedThinkingLevel?: string,
): Record<string, unknown> {
  const model = liveMeta?.model ?? recorded;
  const thinkingLevel = liveMeta?.thinkingLevel ?? recordedThinkingLevel;
  return {
    ...(model ? { model } : {}),
    ...(thinkingLevel ? { thinkingLevel } : {}),
    ...(liveMeta?.harness ? { harness: liveMeta.harness } : {}),
    ...(liveMeta?.liveModels?.models.length ? { liveModels: liveMeta.liveModels } : {}),
  };
}
