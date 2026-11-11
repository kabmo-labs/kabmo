/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The anchor a per-message Fork may carry.
 *
 * A fork cuts the transcript Kabmo can read, so the anchor is only meaningful
 * where that transcript exists (`harnessHasLocalTranscript`). An agent that
 * keeps its history in its own store forks the chat WHOLE — `session/fork`
 * takes no anchor — so the anchor is dropped here and the composer's preview
 * shows every row the branch will hold, instead of promising a cut the agent
 * cannot make.
 *
 * `claude` is the exception: claude-agent-acp reads a fork point from
 * `_meta.jetbrains.air.fork` (the AIR extension) and keeps the history up to
 * that message. Its resolver only groups ASSISTANT entries, so a user row has
 * no fork point there and stays a whole-chat fork.
 */

import { harnessHasLocalTranscript } from '@/shared/lib/harness/transcript';
import { forkCapability } from '@/shared/lib/harness/fork';

/** The two rows that offer Fork: a user turn and an assistant run footer. */
export type ForkAnchorRole = 'user' | 'assistant';

/**
 * Whether this harness can fork at a row of this role at all. The UI asks this
 * before drawing the button: a control that can only answer "whole chat" (or
 * nothing) is not a per-message fork.
 */
export function canForkAt(
  harness: string | null | undefined,
  role: ForkAnchorRole,
): boolean {
  if (forkCapability(harness) !== 'message') return false;
  return harnessHasLocalTranscript(harness) || role === 'assistant';
}

export function forkAnchorFor(
  harness: string | null | undefined,
  messageId: string,
  role: ForkAnchorRole,
): string | null {
  return canForkAt(harness, role) ? messageId : null;
}
