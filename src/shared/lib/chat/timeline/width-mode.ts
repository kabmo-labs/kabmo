/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * How wide the chat's content column is allowed to be, as ONE of three modes.
 *
 * This is a READING width, not a layout: unlike `editorViewMode` (whose
 * `compact` and `full` hide the chat and the sidebar), no mode here hides a
 * panel or moves a control. Only the column's `max-width` changes.
 *
 *  - `compact` — a narrow column, for a laptop with a panel open beside it.
 *  - `wide`    — the width Kabmo has always shipped, and the default.
 *  - `full`    — the whole chat panel, for a table, a diff or a long log.
 *
 * **The mode NAMES and the copy live here; the PIXELS live in CSS** (the
 * `--chat-column-max` table in `src/client/tailwind.css`). Splitting them this
 * way is deliberate: the settings UI needs the list and the labels, the layout
 * needs the numbers, and neither file restates the other's fact. A mode added
 * here without a matching CSS rule would render at the `wide` width — visible
 * immediately, not silently wrong.
 *
 * The mode reaches the layout as `data-chat-width` on `<html>`, never as a
 * prop: `PendingChatView` (an early return with its own root),
 * `SessionSkeleton`, `SubagentView` and the timeline body are four separate
 * subtrees, and a prop would be four call sites that can each be missed.
 */

export type ChatWidthMode = 'compact' | 'wide' | 'full';

/**
 * The mode a document with no stored preference renders at. It is the value
 * Kabmo shipped before the setting existed, so an upgrade changes nothing and a
 * page served by an older build — which has no attribute at all — still lands
 * on the column its CSS declares in `:root`.
 */
export const DEFAULT_CHAT_WIDTH_MODE: ChatWidthMode = 'wide';

/** Document attribute carrying the mode. Read by CSS only. */
export const CHAT_WIDTH_ATTRIBUTE = 'data-chat-width';

/**
 * Every mode, in the order the settings control lists them: narrowest to
 * widest, so the row reads as a scale.
 */
export const CHAT_WIDTH_MODES = ['compact', 'wide', 'full'] as const;

/** A stored value written by another build is not a mode this one can draw. */
export function isChatWidthMode(value: unknown): value is ChatWidthMode {
  return value === 'compact' || value === 'wide' || value === 'full';
}

/**
 * The mode to APPLY for a stored value. Anything this build cannot draw — a
 * value from a newer build, a corrupted blob, `undefined` on a fresh install —
 * falls back to the default rather than to an attribute CSS has no rule for.
 */
export function resolveChatWidthMode(value: unknown): ChatWidthMode {
  return isChatWidthMode(value) ? value : DEFAULT_CHAT_WIDTH_MODE;
}

export interface ChatWidthModeCopy {
  /** Control label. */
  label: string;
  /** One line under the label, in the settings card. */
  description: string;
}

/** Labels for the settings control. Numbers stay in CSS — see the header. */
export const CHAT_WIDTH_MODE_COPY: Record<ChatWidthMode, ChatWidthModeCopy> = {
  compact: {
    label: 'Compact',
    description: 'A narrower column. The shortest line length, and the most room for the panels beside it.',
  },
  wide: {
    label: 'Wide',
    description: 'The default column. Answers, tool cards and the composer share it.',
  },
  full: {
    label: 'Full',
    description: 'The whole chat panel, transcript and composer alike. For tables, diffs and long logs.',
  },
};
