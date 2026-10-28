/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Client view of the waiting prompts (`waiting_prompts`, owned by the server).
 *
 * The panel is a VIEW, exactly like the follow-up queue: the server holds the
 * clock, the row is the state, and this hook reads it off the `waiting` topic.
 * The HTTP route is the fallback for a socket that is down.
 */

import { useCallback, useEffect, useState } from 'preact/hooks';
import { useRealtimeTopic } from '@/client/hooks/ui/realtime';
import { TOPIC_WAITING } from '@/shared/lib/realtime/protocol';
import type { WaitingPrompt } from '@/shared/types/waiting';

export interface WaitingPromptsState {
  prompts: WaitingPrompt[];
  /**
   * Whether the list has been READ from the server.
   *
   * Load-bearing for anything that CLEARS state from an absence: before the
   * first payload, "no row names this wait" is not a fact, it is a page that
   * has not loaded yet. Clearing on it deleted a cue the user had just created —
   * the controller's effect runs on the render the hold triggers, one frame
   * before the topic's first snapshot.
   */
  loaded: boolean;
  /** Ask the server for a fresh snapshot (a manual refresh). */
  refresh: () => void;
}

export function useWaitingPrompts(): WaitingPromptsState {
  const topic = useRealtimeTopic<WaitingPrompt[]>(TOPIC_WAITING);
  const [fallback, setFallback] = useState<WaitingPrompt[]>([]);
  const [loadedFallback, setLoadedFallback] = useState(false);

  // The topic is the source; the HTTP read only fills in before the first frame
  // lands, or when the socket is down (a phone that just woke).
  useEffect(() => {
    if (Array.isArray(topic.data)) return;
    let active = true;
    fetch('/api/waiting')
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!active || !Array.isArray(data?.prompts)) return;
        setFallback(data.prompts as WaitingPrompt[]);
        setLoadedFallback(true);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [topic.data]);

  const fromTopic = Array.isArray(topic.data);
  const prompts = fromTopic ? (topic.data as WaitingPrompt[]) : fallback;
  const refresh = useCallback(() => topic.refresh(), [topic]);
  return {
    prompts,
    // The HTTP read counts too: it is the same list, and a socket that is down
    // must not leave every consumer believing the server holds nothing.
    loaded: fromTopic || loadedFallback,
    refresh,
  };
}

/** Create a held prompt. Throws the server's own reason on a refusal. */
export async function createWaitingPromptRequest(input: {
  pendingId: string | null;
  dependsOn: string;
  dependsOnTitle: string | null;
  prompt: string;
  attachments: unknown[];
  model: unknown;
  modes: { plan: boolean; goal: boolean } | null;
  cwd: string;
  folderId: number | null;
}): Promise<WaitingPrompt> {
  const response = await fetch('/api/waiting', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.prompt) {
    throw new Error(typeof data?.error === 'string' ? data.error : `HTTP ${response.status}`);
  }
  return data.prompt as WaitingPrompt;
}

/** Cancel a held prompt. Returns the server's refusal rather than swallowing it. */
export async function cancelWaitingPromptRequest(id: string): Promise<{ ok: boolean; error?: string }> {
  const response = await fetch(`/api/waiting?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (response.ok) return { ok: true };
  const data = await response.json().catch(() => null);
  return { ok: false, error: typeof data?.error === 'string' ? data.error : `HTTP ${response.status}` };
}
