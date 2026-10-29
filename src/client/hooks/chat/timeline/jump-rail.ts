/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The timeline's jump rail, assembled: the mounted row window, the full-history
 * turn index, the paging walk, and the follow-mode handoff around it.
 *
 * They are one unit because a rail click needs all three, in this order — the
 * window is what the reveal scrolls through, the index is what the rail lists,
 * and the paging walk is what brings an unloaded turn into the window. Keeping
 * the wiring here also keeps `hooks/chat/timeline/index.ts` (the orchestrator
 * for the whole chat) at its own size ceiling.
 *
 * See `row-window.ts` for the window, `user-turns.ts` for the index, and
 * `rail-jump.ts` for why follow mode has to stand down for the duration.
 */

import { useMemo } from 'preact/hooks';
import type { RefObject } from 'preact/compat';
import { useTimelineRowWindow, type TimelineRowWindow } from '@/client/hooks/chat/timeline/row-window';
import { useRailJump } from '@/client/hooks/chat/timeline/rail-jump';
import { useUserTurns } from '@/client/hooks/chat/timeline/user-turns';
import type { ChatMessageData, UserTurnRef } from '@/shared/types';

export interface UseTimelineJumpRailDeps {
  sessionId: string | null;
  /** The mounted timeline (the loaded window, not the whole session). */
  messages: ChatMessageData[];
  /** Pages history until the turn's row is mounted (session-pagination). */
  jumpToTurn: (id: string, index: number) => Promise<boolean>;
  /** Scroll hook's follow flag, held off for the whole jump. */
  followRef: RefObject<boolean>;
  /** The timeline's scroll container. */
  scrollRef: RefObject<HTMLDivElement>;
  /** The same container as state — see `useTimelineRowWindow`. */
  scrollNode: HTMLDivElement | null;
}

export interface TimelineJumpRail {
  /** Every user turn of the session, oldest first. */
  userTurns: UserTurnRef[];
  /** A jump is paging history to reach the clicked turn. */
  jumpingTurn: boolean;
  jumpToUserTurn: (id: string, index: number) => Promise<boolean>;
  /** Which rows of `messages` are mounted. */
  rowWindow: TimelineRowWindow;
}

export function useTimelineJumpRail(deps: UseTimelineJumpRailDeps): TimelineJumpRail {
  const { sessionId, messages, jumpToTurn, followRef, scrollRef, scrollNode } = deps;
  const rowIds = useMemo(() => messages.map((message) => message.id), [messages]);
  const rowWindow = useTimelineRowWindow({ ids: rowIds, scrollRef, scrollNode });
  const { turns: userTurns, jumping: jumpingTurn, jumpToTurn: pagedJumpToTurn } = useUserTurns({
    sessionId,
    messages,
    jumpToTurn,
    revealRow: rowWindow.revealRow,
  });
  const jumpToUserTurn = useRailJump(pagedJumpToTurn, { followRef, scrollRef });
  return { userTurns, jumpingTurn, jumpToUserTurn, rowWindow };
}
