/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The provider/model the generating indicator names a run by.
 *
 * The run's model is persisted BESIDE the stream status and rides the sidebar
 * payload, so the indicator names the real provider/model even for a run this
 * page never started. The transcript is the fallback, not the source: a freshly
 * spawned session has no readable JSONL yet, and one loaded from history may
 * carry a model the run has since switched away from.
 */

import { useMemo } from 'preact/hooks';
import type { WorkspaceFolderData } from '@/shared/types';
import type { SessionDataShape } from '@/client/hooks/chat/timeline/session-shapes';

export interface RunIdentity {
  sessionProvider?: string;
  sessionModelName?: string;
}

export interface RunIdentityInput {
  folders: WorkspaceFolderData[];
  sessionId: string | null;
  sessionData: SessionDataShape | null | undefined;
  modelNames: Record<string, string>;
}

export function runIdentityFor(input: RunIdentityInput): RunIdentity {
  const { folders, sessionId, sessionData, modelNames } = input;
  const sidebar = folders.flatMap((f) => f.sessions ?? []).find((s) => String(s.id) === String(sessionId)) ?? null;
  const runModel = sidebar?.runModel ?? null;
  // The sidebar's model describes the RUN row beside it. While a run is live it
  // is the freshest identity (it is renamed from `get_state` mid-run), but for
  // an idle chat it is the model of the LAST run — a `set_model` after that run
  // never reached it, so the footer and the composer kept naming the first
  // model the chat ever picked. An idle chat reads the session's own metadata,
  // which `/api/chat/:id` re-reads from the live agent on a `model_changed`.
  const liveRun = sidebar?.streamStatus === 'stream';
  const fallback = sessionData?.model;
  const fallbackModel = typeof fallback === 'object' ? fallback : null;
  const chosen = liveRun ? runModel : (fallbackModel ?? runModel);
  return {
    sessionProvider: chosen?.provider,
    sessionModelName: chosen?.modelId
      ? (modelNames[chosen.modelId] ?? chosen.modelId)
      : (typeof fallback === 'string' ? fallback : undefined),
  };
}

export function useRunIdentity(input: RunIdentityInput): RunIdentity {
  const { folders, sessionId, sessionData, modelNames } = input;
  return useMemo(() => runIdentityFor(input), [folders, sessionId, sessionData, modelNames]);
}
