/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Full-history user-turn index for the timeline jump rail.
 *
 * The timeline mounts a window of a long session (newest 120 messages plus
 * whatever "Load earlier messages" paged in), so a rail built from the mounted
 * rows lists only that fraction — the bug this hook exists to fix. The index
 * comes from `/api/chat/:id/turns`, which walks the whole session with the same
 * id/merge pipeline as the timeline, so a rail tick always resolves to a row
 * the timeline can actually reach by paging.
 *
 * Live rows the committed history does not carry yet (an optimistic send in
 * flight) are appended with `index: -1` — they are on screen already, and
 * dropping them would make the rail lag one turn behind the composer.
 */

import { useEffect, useMemo, useState } from 'preact/hooks';
import { TURN_PREVIEW_CHARS } from '@/shared/lib/chat/timeline/turns';
import type { ChatMessageData, UserTurnRef } from '@/shared/types';

/** Appended live rows are already mounted; the jump reads this as "no paging
 *  needed" rather than as a position in the committed list. */
const LIVE_TURN_INDEX = -1;

export interface UserTurnsState {
  /** Every user turn of the session, oldest first. */
  turns: UserTurnRef[];
  /** A jump is walking history to reach the clicked turn. */
  jumping: boolean;
  /** Resolve a turn's row and bring it into view; false when unreachable. */
  jumpToTurn: (id: string, index: number) => Promise<boolean>;
}

export interface UseUserTurnsDeps {
  sessionId: string | null;
  /** Mounted timeline: its user rows are merged into the index so a just-sent
   *  turn is on the rail before the committed history carries it — and they
   *  ARE the index until the fetch lands, so the rail is never blank on a
   *  session that already shows turns. */
  messages: ChatMessageData[];
  /** Pages history until the turn's row is mounted (session-pagination). */
  jumpToTurn: (id: string, index: number) => Promise<boolean>;
}

/** How long a jump waits for the row it paged in to commit. A single prepend
 *  can add hundreds of rows, so this is wall-clock bounded rather than
 *  frame-counted — 30 frames is not enough to lay out a large window. */
const ROW_COMMIT_TIMEOUT_MS = 3000;

/** Wait for a row the paging walk just requested to commit, then center it.
 *  The prepend and the jump's own scroll are separate commits: the walk
 *  resolves before the DOM has the node, so this polls until it appears
 *  instead of scrolling to a row that does not exist yet. */
function scrollToRow(id: string, deadline = Date.now() + ROW_COMMIT_TIMEOUT_MS): void {
  const el = document.getElementById(id);
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  if (Date.now() >= deadline) return;
  requestAnimationFrame(() => scrollToRow(id, deadline));
}

export function useUserTurns(deps: UseUserTurnsDeps): UserTurnsState {
  const { sessionId, messages, jumpToTurn } = deps;
  const [indexed, setIndexed] = useState<UserTurnRef[] | null>(null);
  const [jumping, setJumping] = useState(false);

  // Mounted user rows, as rail entries. `index: -1` says "already on screen" —
  // true by construction here, and true for the mounted rows the full index
  // does not carry yet (a live send, a turn committed after the fetch).
  const mountedTurns = useMemo(() => {
    const rows: UserTurnRef[] = [];
    for (const message of messages) {
      if (message.role !== 'user') continue;
      rows.push({
        id: message.id,
        index: LIVE_TURN_INDEX,
        preview: (message.content ?? '').slice(0, TURN_PREVIEW_CHARS),
        date: message.date,
        timestamp: message.timestamp,
      });
    }
    return rows;
  }, [messages]);

  // The last mounted user row id is the cheapest "the committed history moved"
  // signal: a send, a commit reconciliation, or an undo/rewind changes it,
  // while paging older windows does not — so the index refetches exactly when
  // its content can have gone stale.
  const lastUserId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i]?.role === 'user') return messages[i].id;
    }
    return '';
  }, [messages]);

  useEffect(() => {
    if (!sessionId || sessionId.startsWith('new-')) {
      setIndexed(null);
      return;
    }
    let active = true;
    fetch(`/api/chat/${encodeURIComponent(sessionId)}/turns`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { turns?: UserTurnRef[] } | null) => {
        if (!active || !data || !Array.isArray(data.turns)) return;
        setIndexed(data.turns);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [sessionId, lastUserId]);

  const turns = useMemo(() => {
    // Until the index lands the mounted rows ARE the rail: a session that
    // already shows turns never renders an empty rail.
    if (!indexed) return mountedTurns;
    const knownIds = new Set(indexed.map((turn) => turn.id));
    // Committed turns with no mounted row of their own. A reconciled echo puts
    // its own id back on the mounted row, so an entry left in here is one the
    // mounted window still shows under a DIFFERENT id — the optimistic
    // `msg-…-user` the composer mounted, awaiting the echo.
    const mountedIds = new Set(mountedTurns.map((turn) => turn.id));
    const orphanedCommitted = indexed.filter((turn) => !mountedIds.has(turn.id));
    // Rows the index does not carry yet (a live send, a turn committed after
    // the fetch) are already mounted, so they belong on the rail too.
    //
    // Identity alone is not enough. A sent turn lives under TWO ids for a
    // moment: the optimistic bubble (`msg-…-user`) and the id omp echoed for
    // the same request. The `/turns` index reports the echoed id as soon as the
    // transcript has it, while `localMessages` still carries the optimistic one
    // until the echo reconciles them — so an id-only match listed one turn
    // twice, the second entry pointing at a DOM id the reconciliation had
    // already replaced.
    //
    // The pairing is deliberately PER ROW, not a "have I seen this text" set:
    // a user who sends the same text twice has two turns, and the second must
    // not be swallowed by the first. So a live row stands down only against an
    // orphaned committed entry it actually matches, and that entry is consumed
    // so two identical prompts cannot both pair with one entry. Preview
    // equality is exact — both sides truncate the same content at
    // `TURN_PREVIEW_CHARS`, so a real match is byte-identical, while a prefix
    // test would swallow a genuine short prompt that opens with an earlier
    // turn's words.
    const paired = new Set<string>();
    const extra = mountedTurns.filter((turn) => {
      if (knownIds.has(turn.id)) return false;
      const match = orphanedCommitted.find(
        (entry) => !paired.has(entry.id) && entry.preview === turn.preview,
      );
      if (!match) return true;
      paired.add(match.id);
      return false;
    });
    return extra.length > 0 ? [...indexed, ...extra] : indexed;
  }, [indexed, mountedTurns]);

  const jump = async (id: string, index: number): Promise<boolean> => {
    // A row with no committed position is mounted by definition, and so is one
    // inside the loaded window — both only need the scroll below.
    if (index < 0) {
      scrollToRow(id);
      return true;
    }
    setJumping(true);
    try {
      const reached = await jumpToTurn(id, index);
      if (reached) scrollToRow(id);
      return reached;
    } finally {
      setJumping(false);
    }
  };

  return { turns, jumping, jumpToTurn: jump };
}
