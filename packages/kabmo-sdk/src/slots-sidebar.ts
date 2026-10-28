/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The sidebar: the sessions a workspace holds, and the actions a plugin may take
 * on one.
 *
 * **EXPERIMENTAL.** Marked as such because bb marks its own thread hooks
 * experimental, and the surface is large enough that its shape may move. A
 * plugin that uses it should expect the API to change between minor versions.
 *
 * bb calls this a "thread"; Kabmo calls the same thing a SESSION. They are
 * one concept under two names — a single conversation with the agent, listed in
 * the sidebar under the folder it ran in — and this module deliberately uses the
 * Kabmo's word, because that is what the host's own code, routes and types
 * already say.
 *
 * Two rules are what make this safe to hand a plugin:
 *
 * - **The read is a PROJECTION of the host's own sidebar topic**, not a second
 *   fetch. A plugin therefore sees exactly what the sidebar sees, including a
 *   run in flight, and cannot disagree with the list beside it.
 * - **A write goes through the host's own routes.** There is no second session
 *   store: `rename` posts the rename the sidebar's own inline editor posts, so
 *   the two cannot drift, and a refusal (an invalid name, a session this host
 *   does not own) surfaces as the server's own reason.
 */

/**
 * One session row, as the sidebar holds it.
 *
 * A deliberate subset of the host's row: what a plugin can act on and display
 * without reaching into Kabmo internals. `folderId` is what an action needs to
 * address the session, and the ids are opaque — a plugin must not parse them.
 */
export interface SidebarThread {
  id: string;
  /** The workspace folder this session is listed under. */
  folderId: string;
  title: string;
  /** ISO timestamp of the session's last entry, when the host knows it. */
  updatedAt?: string;
  /** A run is in flight for this session, from the host's own status map. */
  isRunning?: boolean;
  /** The session's omp process is blocked on a question awaiting an answer. */
  awaitingInput?: boolean;
  /** Archived sessions are still listed; the host's own views filter them. */
  isArchived?: boolean;
}

/**
 * The sidebar read.
 *
 * `isLoading` is separate from an empty list because the two are different
 * states on screen, and `stale` says the socket is down — a list shown as
 * current when it is not is worse than one that admits it.
 */
export interface SidebarThreadsState {
  threads: SidebarThread[];
  isLoading: boolean;
  stale: boolean;
  /** Ask the host for a fresh sidebar snapshot. */
  refresh(): void;
}

/**
 * The actions a plugin may take on a session.
 *
 * Each answers `true` on success and `false` on a refusal, and the refusal's
 * reason is surfaced through `error` rather than thrown — the host's routes
 * answer a refusal as a value, and a plugin that has to catch would lose the
 * server's own wording.
 *
 * `open` is navigation, not a mutation: it is the same "select this session"
 * the sidebar row performs, so a plugin can deep-link into a conversation.
 *
 * There is deliberately NO `setPinned`. The Kabmo pins a FOLDER, not a
 * session (`POST /api/folders/:id`), so offering a session pin here would be a
 * control that cannot do what it says.
 */
export interface SidebarThreadActions {
  /** Select a session, as clicking its row does. */
  open(sessionId: string): void;
  /** Rename a session. Resolves false when the host refused the name. */
  rename(sessionId: string, title: string): Promise<boolean>;
  /** Archive or restore a session. */
  setArchived(sessionId: string, archived: boolean): Promise<boolean>;
  /** Mark a session's `finish`/`abort` badge as seen. */
  markSeen(sessionId: string): Promise<boolean>;
  /** Delete a session. */
  remove(sessionId: string): Promise<boolean>;
  /** Start a new session, optionally in a named folder. */
  openNew(options?: { folderId?: string }): void;
  /** The last refusal's reason, or null. */
  readonly error: string | null;
}
