/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Payload shapes for the realtime topics. One file so a producer and its
 * consumer cannot disagree about what a topic carries.
 */

import type { SessionRunModel } from '@/shared/lib/omp/session/stream-state.server';
import type { WorkspaceFolderData } from '@/shared/types/workspace';

/** `sidebar` — folder structure and session identity, without volatile fields. */
export interface SidebarPayload {
  folders: WorkspaceFolderData[];
  isMock: boolean;
}

/**
 * One session's volatile sidebar fields.
 *
 * Split out of `SidebarPayload` because these change on every stream-status
 * write while the structure needs a JSONL scan to produce: shipping the whole
 * list per `agent_start` would be the same waste the poll it replaces had.
 */
export interface SidebarStatusEntry {
  streamStatus?: 'stream' | 'finish' | 'abort';
  awaitingInput?: boolean;
  runModel?: SessionRunModel;
  /**
   * Epoch ms the live run entered `stream`, from `session_stream_state`.
   *
   * A row's elapsed clock is measured against this, never against the moment
   * this tab first saw the run: the start is durable, so a reload, a second
   * tab or a reconnect resumes the same count instead of restarting at zero.
   * Absent on terminal badges (the run is over) and on rows written before the
   * column existed, where the row falls back to its age.
   */
  runStartedAt?: number;
  /** Present only on a failed terminal run; the notification's own reason. */
  runFailure?: string;
}

/** `sidebar:status` — keyed by session id. Absent id means "no volatile fields". */
export type SidebarStatusPayload = Record<string, SidebarStatusEntry>;

/**
 * One live session's row fields that can still move between turn boundaries.
 *
 * Exactly two, and the list is closed on purpose: everything else about a row
 * (title, folder, cwd, worktree, archived) only changes on a STRUCTURAL event
 * that publishes the structure for its own reason. These two are the ones a
 * run advances mid-turn — the transcript appends, and a subagent's transcript
 * appears beside it (which is what lights the row's roster chevron).
 */
export interface SidebarActivityEntry {
  /** Newest transcript entry's ISO timestamp — the row's age and its
   *  `LATEST_SESSION` position. */
  updatedAt?: string;
  /** Whether the session has any subagent transcript on disk. */
  hasSubagents?: boolean;
}

/**
 * `sidebar:activity` — session id → the live fields above, for the sessions
 * with a run in flight.
 *
 * Only a running session can move between turn boundaries, so an id that is
 * absent here simply keeps what the structure gave it. Both sides read the same
 * sources (the newest JSONL entry's own `timestamp`, and the subagent
 * transcript directory), so the client merges field by field and lets the
 * newer stamp win.
 */
export type SidebarActivityPayload = Record<string, SidebarActivityEntry>;
