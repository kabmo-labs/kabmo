/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The composer draft's home in a session's UI state.
 *
 * The keys are named here rather than spelled at each call site because TWO
 * surfaces ask about the same value and must agree: the timeline writes the
 * draft the user is typing, and the sidebar asks whether a brand-new chat still
 * HAS one before it keeps that chat's row. A second literal spelling is how the
 * row goes on being drawn for a chat with nothing behind it — the reported
 * "new session yang tidak dikirim tidak hilang dari session sidebar".
 */

/** The composer's text for a session. */
export const CHAT_DRAFT_KEY = 'chat.draft';
/** The composer's pending attachments for a session. */
export const CHAT_DRAFT_ATTACHMENTS_KEY = 'chat.draftAttachments';

/**
 * Whether a session's UI-state entry carries something the user typed and never
 * sent.
 *
 * An ABSENT entry counts as a draft, and the direction of that default is the
 * point: a pending chat's blob is read the moment it becomes the open session,
 * so a missing entry means the read has not landed rather than that the
 * composer is empty. Dropping the row in that window would take away the only
 * visible way back to a draft that does exist. A PRESENT entry with a blank
 * draft is the negative answer, and that is what retires the row.
 */
export function hasComposerDraft(state: Readonly<Record<string, unknown>> | undefined): boolean {
  if (!state) return true;
  const text = state[CHAT_DRAFT_KEY];
  if (typeof text === 'string' && text.trim().length > 0) return true;
  const attachments = state[CHAT_DRAFT_ATTACHMENTS_KEY];
  return Array.isArray(attachments) && attachments.length > 0;
}
