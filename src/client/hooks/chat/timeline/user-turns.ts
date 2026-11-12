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
  /**
   * Scroll a row into view by id, mounting it if it is outside the timeline's
   * mounted window.
   *
   * `scrollIntoView` is not enough once the timeline mounts a WINDOW of its
   * rows: the target of a rail jump is usually hundreds of rows above the
   * viewport and therefore has no DOM node to scroll to. This is the window's
   * own reveal (`row-window.ts`), which writes the row's measured offset first
   * and corrects it for a few frames.
   */
  revealRow: (id: string) => Promise<void>;
}

export function useUserTurns(deps: UseUserTurnsDeps): UserTurnsState {
  const { sessionId, messages, jumpToTurn, revealRow } = deps;
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
    //
    // The pair is also NEWER than every committed turn the client still has
    // mounted. That is what makes the match the same turn rather than two
    // prompts that happen to read alike: the entry this live row stands for was
    // committed after everything on screen, so an older tick can never be
    // re-pointed at it (which would strand the older turn).
    const newestMountedCommitted = indexed.reduce(
      (newest, turn) => (mountedIds.has(turn.id) ? Math.max(newest, turn.index) : newest),
      -1,
    );
    const paired = new Set<string>();
    // Committed entry id → the id its row is mounted under RIGHT NOW.
    //
    // The committed index names the id omp recorded, and the mounted row does
    // not carry it yet: omp echoes the user turn LATE (after the assistant
    // segment), and until that echo the bubble the composer mounted keeps its
    // optimistic `msg-…-user` id. Listing the committed id named a DOM node
    // that does not exist, so a rail click on the newest turn paged nowhere and
    // then waited out the reveal's deadline — the reported "cannot jump to the
    // message I just sent until I reload". The listing therefore takes the
    // DOM id from the row it is already drawing, and keeps the entry's own
    // index (the paging cursor). Once the echo reconciles, the ids agree and
    // this map is empty.
    const rowIdFor = new Map<string, string>();
    const extra = mountedTurns.filter((turn) => {
      if (knownIds.has(turn.id)) return false;
      const match = orphanedCommitted.find(
        (entry) => entry.index > newestMountedCommitted && !paired.has(entry.id) && entry.preview === turn.preview,
      );
      if (!match) return true;
      paired.add(match.id);
      rowIdFor.set(match.id, turn.id);
      return false;
    });
    const listed = extra.length > 0 ? [...indexed, ...extra] : indexed;
    if (rowIdFor.size === 0) return listed;
    return listed.map((turn) => {
      const rowId = rowIdFor.get(turn.id);
      return rowId ? { ...turn, id: rowId } : turn;
    });
  }, [indexed, mountedTurns]);

  const jump = async (id: string, index: number): Promise<boolean> => {
    setJumping(true);
    try {
      // A row with no committed position is mounted by definition, and so is
      // one inside the loaded window — both only need the scroll below. The
      // reveal is AWAITED so `useRailJump` holds follow mode off until the
      // viewport has actually landed: a reveal it could not see left the
      // scroll hook free to re-pin the tail on the next prepend, which is how
      // a rail click ended at the bottom of the session instead of the turn.
      if (index < 0) {
        await revealRow(id);
        return true;
      }
      const reached = await jumpToTurn(id, index);
      if (reached) await revealRow(id);
      return reached;
    } finally {
      setJumping(false);
    }
  };

  return { turns, jumping, jumpToTurn: jump };
}
