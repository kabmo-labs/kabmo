/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The source transcript a fork will carry, for the pending composer's preview.
 *
 * A fork is composed as an EMPTY chat today, so the operator picks the first
 * turn without seeing the history that turn continues. This slices the source's
 * rows the way the server slices its JSONL (`cutIndexFor` in
 * `fork.server.ts`), so what the preview shows is exactly what the branch file
 * will hold:
 *
 *  - an anchor on a USER turn branches BEFORE it — that message is the one
 *    being replaced, so it is not part of the fork;
 *  - an anchor anywhere else (an assistant reply, a tool row) branches AFTER
 *    the turn that contains it — the reply the user pointed at is kept;
 *  - no anchor, or an id the transcript does not carry, is the tip: everything.
 */

import type { ChatMessageData } from '@/shared/types';

export function forkPreviewMessages(
  messages: ChatMessageData[],
  anchorEntryId: string | null | undefined,
): ChatMessageData[] {
  if (!anchorEntryId) return messages;
  const anchorIndex = messages.findIndex((message) => message.id === anchorEntryId);
  if (anchorIndex === -1) return messages;
  if (messages[anchorIndex]?.role === 'user') return messages.slice(0, anchorIndex);
  const nextTurn = messages.findIndex(
    (message, index) => index > anchorIndex && message.role === 'user',
  );
  return messages.slice(0, nextTurn === -1 ? messages.length : nextTurn);
}
