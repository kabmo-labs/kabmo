/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A prompt held until another session finishes.
 *
 * The row is Kabmo's own (SQLite `waiting_prompts`): omp has no notion of a
 * prompt that has not been sent yet, so the wait has to live somewhere that
 * outlives the tab. Its `dependsOn` session is a SESSION ID, never a snapshot of
 * its state — the state is re-read at each sweep, because a session that looks
 * finished can pick up a queued follow-up a moment later.
 */

import type { Attachment, QueuedMessageModel } from '@/shared/types/chat';

export type WaitingPromptStatus = 'waiting' | 'dispatched' | 'cancelled' | 'error';

/** Plan/goal flags the spawn must carry (a new session has no JSONL to read). */
export interface WaitingPromptModes {
  plan: boolean;
  goal: boolean;
}

export interface WaitingPrompt {
  id: string;
  /**
   * The client's pending id (`new-…`) this prompt belongs to. The dispatch
   * answers with omp's real session id, and the client moves the sidebar row
   * across by this pairing — the same adoption the local send path performs.
   */
  pendingId: string | null;
  /** The session whose completion releases this prompt. */
  dependsOn: string;
  /** Title of `dependsOn` at creation time, for the waiting row's own label. */
  dependsOnTitle: string | null;
  /** Composer text as the user typed it. */
  prompt: string;
  attachments: Attachment[];
  /** Model/thinking/access snapshot, replayed at dispatch. */
  model: QueuedMessageModel | null;
  modes: WaitingPromptModes | null;
  /** Absolute directory the new session spawns in, resolved at creation. */
  cwd: string;
  folderId: number | null;
  status: WaitingPromptStatus;
  /** omp's real session id, once the prompt was dispatched. */
  sessionId: string | null;
  /** Why the dispatch failed (status `error`). */
  error: string | null;
  createdAt: number;
  updatedAt: number;
}
