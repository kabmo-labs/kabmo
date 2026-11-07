/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The NAME of a chat that runs on another harness, persisted.
 *
 * An ACP agent writes no session file, so omp's JSONL discovery — the thing that
 * names every omp row (`sessionTitleFor`) — has nothing to read: `acpRowsFor`
 * drew `Untitled` for every recorded chat, forever, for a conversation whose
 * first line was already in the database. Measured an hour after a `claude`
 * chat's first prompt: the row still read `Untitled`, while the placeholder row
 * it replaced had shown the user's own words.
 *
 * Two sources, and the ORDER is what names a chat:
 *
 *  - the FIRST PROMPT, which Kabmo owns and which every other row source already
 *    uses to name a nameless chat;
 *  - the AGENT's own title (`session_info_update`), which overwrites the guess
 *    once the agent names the chat the way it sees it.
 *
 * A later prompt never overwrites anything — see
 * `saveHarnessSessionTitleIfEmpty`, whose whole point is that a steering message
 * or a queued follow-up cannot rename a chat to its own text.
 */

import { emitRealtimeSignal } from '@/server/lib/realtime/signals.server';
import {
  saveHarnessSessionTitle,
  saveHarnessSessionTitleIfEmpty,
} from '@/server/lib/harness/session-store.server';

/**
 * The most of a prompt a stored title keeps.
 *
 * Matches the 120 `sessionTitleFor` keeps of an omp session's first message, so
 * the two row sources cut a long first line at the same place.
 */
const PROMPT_TITLE_MAX = 120;

/** A prompt as a title: one line, collapsed whitespace, bounded. */
export function titleFromPrompt(message: string): string {
  return message.trim().replace(/\s+/g, ' ').slice(0, PROMPT_TITLE_MAX);
}

/**
 * Remember the first prompt as this chat's title.
 *
 * Returns the write, so a caller that cares can await it (and so a test can
 * assert on the publish without sleeping). The prompt path ignores it: a name is
 * not worth failing a prompt over, and the structure publish is what makes an
 * open sidebar draw the row with its new text.
 */
export async function notePromptTitle(sessionId: string, message: string): Promise<boolean> {
  const title = titleFromPrompt(message);
  if (!sessionId || !title) return false;
  const written = await saveHarnessSessionTitleIfEmpty(sessionId, title).catch(() => false);
  if (written) emitRealtimeSignal('sidebar-structure');
  return written;
}

/** Adopt the title the AGENT published; it outranks the first-prompt guess. */
export async function noteAgentTitle(sessionId: string, title: string): Promise<boolean> {
  const next = title.trim();
  if (!sessionId || !next) return false;
  const written = await saveHarnessSessionTitle(sessionId, next).catch(() => false);
  if (written) emitRealtimeSignal('sidebar-structure');
  return written;
}
