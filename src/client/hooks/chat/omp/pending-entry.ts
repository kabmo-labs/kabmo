/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * One row the client draws before omp's transcript scan can see the session.
 *
 * Split from the store that owns its lifetime (`pending-sessions.ts`): the
 * type is what three modules share, and keeping it here is what lets the store
 * stay inside the file-size ceiling without a second shape.
 */

export interface PendingSessionEntry {
  /** Client-side `new-<epoch>` id, or the omp UUID a spawn adopted. */
  id: string;
  /** The folder the row belongs to; null resolves from the active session. */
  folderId: number | string | null;
  /** Epoch ms the chat was started — stable across adoption and reloads, so
   *  neither the title nor the ordering can churn on a revalidate. */
  createdAt: number;
  /** Epoch ms a prompt was dispatched for this chat, or null while it is a
   *  draft the user has not sent in. */
  sentAt: number | null;
  /**
   * Set while this chat's prompt is HELD for another session to finish.
   *
   * The row is drawn exactly as it was before the send — same id, same folder —
   * because the session does not exist yet: what the user asked for is that the
   * row stays put and says what it is waiting on. `waitId` is the server row
   * that owns the wait, so cancelling from the row reaches it.
   */
  waiting?: {
    waitId: string;
    dependsOn: string;
    dependsOnTitle: string | null;
  };
  /**
   * The session this pending chat is a CHILD of, when it was started from that
   * row's "New child session" menu. Absent for a top-level New Session.
   *
   * Carried onto the sidebar row so `buildSessionTree` can nest the row under
   * its parent from the first frame — the child exists client-side before omp's
   * transcript scan can see it, exactly like any pending chat.
   */
  parentSessionId?: string;
  /** Harness picked for a pending child, so its mark is drawn before spawn. */
  harness?: string;
  /** Row title override: a pending child names itself "New Child - …". */
  title?: string;
  /**
   * The session this pending chat BRANCHES from, when the Fork button started
   * it. A fork is not a child: it records a source edge, not a parent, so this
   * is kept apart from `parentSessionId`.
   */
  forkSourceSessionId?: string;
  /** The transcript entry the fork cuts at; absent means the source's tip. */
  forkAnchorEntryId?: string;
}
