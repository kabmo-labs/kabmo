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
import type { SessionDataShape } from '@/client/hooks/chat/timeline/session-load';

export interface RunIdentity {
  sessionProvider?: string;
  sessionModelName?: string;
}

export function useRunIdentity(input: {
  folders: WorkspaceFolderData[];
  sessionId: string | null;
  sessionData: SessionDataShape | null | undefined;
  modelNames: Record<string, string>;
}): RunIdentity {
  const { folders, sessionId, sessionData, modelNames } = input;
  const runModel = useMemo(
    () => folders.flatMap((f) => f.sessions ?? []).find((s) => String(s.id) === String(sessionId))?.runModel ?? null,
    [folders, sessionId],
  );
  const fallback = sessionData?.model;
  const fallbackModel = typeof fallback === 'object' ? fallback : null;
  const sessionModelId = runModel?.modelId ?? fallbackModel?.modelId;
  return {
    sessionProvider: runModel?.provider ?? fallbackModel?.provider,
    sessionModelName: sessionModelId
      ? (modelNames[sessionModelId] ?? sessionModelId)
      : (typeof fallback === 'string' ? fallback : undefined),
  };
}
