/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Sidebar session pagination, shared by the desktop workspace category and the
 * mobile drawer item.
 *
 * The list is truncated for height (`useShowMore`), but a session that is
 * OPENED or LIVE must never be one of the hidden rows: the row the operator is
 * reading, the run whose spinner is turning, and the run blocked on a question
 * are the states the sidebar exists to report. Those rows are rendered OUTSIDE
 * the window instead, so the list is `visibleCount` rows or longer exactly when
 * one of them sits past the boundary — never shorter, and never with a session
 * the user is watching missing from it.
 *
 * The "opened or live" rule lives here rather than at either call site, because
 * the two sidebars are the same list on two layouts: one predicate means the
 * desktop sidebar and the phone drawer cannot disagree about which rows are
 * exempt from the window.
 */

import type { SessionItemData } from '@/shared/types';

export interface SessionWindow {
  /** The rows to render, in the source order. */
  rendered: SessionItemData[];
  /** How many rows the next "Show more" click reveals. */
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
 * The first `count` sessions, plus every session that is OPENED or LIVE no
 * matter where it sits. Source order is preserved — an exempt row is never
 * lifted to the top, because the list is ordered by activity and moving one
 * would misreport that.
 *
 * `hiddenCount` counts only the rows the next click actually reveals, which is
 * what the "Show more sessions (n)" label must print: the exempt rows are
 * already on screen and counting them would overstate the remainder.
 */
export function selectVisibleSessions(
  sessions: SessionItemData[],
  count: number,
  { activeSessionId, sessionStatus = {} }: SessionWindowContext,
): SessionWindow {
  if (sessions.length <= count) return { rendered: sessions, hiddenCount: 0 };
  const rendered: SessionItemData[] = [];
  let hiddenCount = 0;
  for (let index = 0; index < sessions.length; index += 1) {
    const session = sessions[index];
    const key = String(session.id);
    // The same test the row itself uses to draw the highlight: the URL's
    // session when one is selected, else the row's own `is_active` flag (which
    // only MOCK's seeded rows ever carry — real mode writes 0 unconditionally).
    const isOpened =
      activeSessionId !== null ? String(activeSessionId) === key : session.is_active === 1;
    const exempt =
      isOpened || sessionStatus[key] === 'stream' || Boolean(session.awaitingInput);
    if (index < count || exempt) rendered.push(session);
    else hiddenCount += 1;
  }
  return { rendered, hiddenCount };
}
