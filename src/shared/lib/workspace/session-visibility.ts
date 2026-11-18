/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Sidebar session pagination, shared by the desktop workspace category and the
 * mobile drawer item.
 *
 * The list is truncated for height (`useShowMore`), and the unit of that window
 * is a ROOT session — one row the sidebar actually draws — not a transcript.
 * Child sessions are rows INSIDE their parent's branch, so letting them take
 * page slots shrank the list the user sees: a folder with three roots whose two
 * children sat inside the window drew two or three top-level rows while the
 * label claimed five. The branch of every kept root travels with it, so a child
 * session is never cut off by a boundary that was counted on its parent.
 *
 * A session that is OPENED or LIVE must never be one of the hidden rows: the
 * row the operator is reading, the run whose spinner is turning, and the run
 * blocked on a question are the states the sidebar exists to report. Such a
 * session keeps its whole branch rendered — including the ancestors a collapsed
 * branch would otherwise hide it behind — so the list is `visibleCount` roots
 * or more exactly when one of them sits past the boundary, never shorter.
 *
 * The "opened or live" rule lives here rather than at either call site, because
 * the two sidebars are the same list on two layouts: one predicate means the
 * desktop sidebar and the phone drawer cannot disagree about which rows are
 * exempt from the window.
 */

import { buildSessionTree, descendantsOf } from '@/shared/lib/workspace/session-tree';
import type { SessionItemData } from '@/shared/types';

export interface SessionWindow {
  /** The rows to render, in the source order. */
  rendered: SessionItemData[];
  /** How many ROOT rows the next "Show more" click reveals. */
  hiddenCount: number;
}

export interface SessionWindowContext {
  /** The session the URL has open, or null when nothing is selected. */
  activeSessionId: number | string | null;
  /**
   * `sessionId → streamStatus`. `stream` is the status the sidebar's own
   * spinner is drawn from; `awaitingInput` rides on the session itself and is
   * the same "your turn" cue `SessionItem` treats as a live run.
   */
  sessionStatus?: Record<string, string | undefined>;
}

/**
 * The first `count` root sessions, each with its full branch, plus every root
 * whose branch holds a session that is OPENED or LIVE. Source order is
 * preserved — an exempt row is never lifted to the top, because the list is
 * ordered by activity and moving one would misreport that.
 *
 * `hiddenCount` counts only the roots the next click actually reveals, which is
 * what the "Show more sessions (n)" label must print: the branch of a hidden
 * root has no row on screen yet, and an exempt branch is already rendered.
 */
export function selectVisibleSessions(
  sessions: SessionItemData[],
  count: number,
  { activeSessionId, sessionStatus = {} }: SessionWindowContext,
): SessionWindow {
  if (sessions.length <= count) return { rendered: sessions, hiddenCount: 0 };

  const exemptIds = new Set<string>();
  for (const session of sessions) {
    const key = String(session.id);
    // The same test the row itself uses to draw the highlight: the URL's
    // session when one is selected, else the row's own `is_active` flag (which
    // only MOCK's seeded rows ever carry — real mode writes 0 unconditionally).
    const isOpened =
      activeSessionId !== null ? String(activeSessionId) === key : session.is_active === 1;
    if (isOpened || sessionStatus[key] === 'stream' || Boolean(session.awaitingInput)) {
      exemptIds.add(key);
    }
  }

  const tree = buildSessionTree(sessions);
  const keptIds = new Set<string>();
  let hiddenCount = 0;

  for (let index = 0; index < tree.roots.length; index += 1) {
    const root = tree.roots[index];
    const rootId = String(root.id);
    const branch = descendantsOf(rootId, tree.childrenOf);
    const exempt = exemptIds.has(rootId) || branch.some((row) => exemptIds.has(String(row.session.id)));
    if (index < count || exempt) {
      keptIds.add(rootId);
      for (const row of branch) keptIds.add(String(row.session.id));
    } else {
      hiddenCount += 1;
    }
  }

  const rendered = sessions.filter((session) => keptIds.has(String(session.id)));
  return { rendered, hiddenCount };
}
