/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * How wide the chat's content column is allowed to be.
 *
 * Three PRESETS (`compact`, `wide`, `full`) plus `custom` — the width the user
 * dragged by hand. This is a READING width, not a layout: unlike
 * `editorViewMode` (whose `compact` and `full` hide the chat and the sidebar),
 * no mode here hides a panel or moves a control. Only the column's `max-width`
 * changes, and the transcript and the composer share the one `.chat-column`
 * rule, so both follow every mode and every drag.
 *
 * **The preset NAMES and the copy live here; the preset PIXELS live in CSS**
 * (the `--chat-column-max` table in `src/client/tailwind.css`). `custom` is the
 * exception, and deliberately so: its number is a value the user chose, so it
 * belongs to the setting rather than to a stylesheet, and the writer sets it as
 * an inline custom property (see `client/hooks/chat/timeline/width-mode.ts`).
 * That is also why there is no `[data-chat-width="custom"]` rule: an attribute
 * with no matching pixel rule falls back to `:root`, and the inline value is
 * what overrides it.
 *
 * The mode reaches the layout as `data-chat-width` on `<html>`, never as a
 * prop: `PendingChatView` (an early return with its own root),
 * `SessionSkeleton`, `SubagentView` and the timeline body are separate
 * subtrees, and a prop would be a call site each that can be missed.
 */

export type ChatWidthPreset = 'compact' | 'wide' | 'full';

export type ChatWidthMode = ChatWidthPreset | 'custom';

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
 * The CSS custom property the column's `max-width` reads. For the presets it is
 * declared by `tailwind.css`; for `custom` the writer sets it inline on
 * `<html>`.
 */
export const CHAT_COLUMN_MAX_VAR = '--chat-column-max';

/**
 * The three fixed modes, in the order the settings control lists them:
 * narrowest to widest, so the row reads as a scale. `custom` is not one of
 * them — a drag produces it, and its number is whatever the user pulled.
 */
export const CHAT_WIDTH_PRESETS = ['compact', 'wide', 'full'] as const;

/** Every mode, presets first. `custom` is a stored state, not a preset. */
export const CHAT_WIDTH_MODES = [...CHAT_WIDTH_PRESETS, 'custom'] as const;

/** Below this a table, a diff or a tool card needs its own horizontal scroll,
 *  so a drag cannot make the column narrower than the reading layout it is. */
export const MIN_CHAT_COLUMN_WIDTH = 420;

/**
 * Upper bound of a STORED custom width. A stored value may be wider than the
 * panel it is drawn in — the column is `width: 100%` under it, so the panel
 * still wins and reopening on a wider display keeps the user's intent. The
 * bound only keeps a corrupted blob (or a hand-edited one) from becoming an
 * arbitrary number.
 */
export const MAX_CHAT_COLUMN_WIDTH = 2400;

/**
 * Width a `custom` column opens at when the user picks the mode without ever
 * having dragged: wider than `wide`, narrower than `full`, so the control has a
 * real effect on the click.
 */
export const DEFAULT_CUSTOM_CHAT_COLUMN_WIDTH = 1120;

/** A stored value written by another build is not a mode this one can draw. */
export function isChatWidthMode(value: unknown): value is ChatWidthMode {
  return value === 'compact' || value === 'wide' || value === 'full' || value === 'custom';
}

/**
 * The mode to APPLY for a stored value. Anything this build cannot draw — a
 * value from a newer build, a corrupted blob, `undefined` on a fresh install —
 * falls back to the default rather than to an attribute CSS has no rule for.
 */
export function resolveChatWidthMode(value: unknown): ChatWidthMode {
  return isChatWidthMode(value) ? value : DEFAULT_CHAT_WIDTH_MODE;
}

/**
 * The pixel width a `custom` column draws at, clamped to what the layout can
 * honour. Anything non-finite (a hand-edited blob, a half-written number, a
 * drag that divided by a zero-width panel) lands on the default rather than on
 * `NaN`, which CSS would ignore while the attribute still claimed `custom`.
 */
export function resolveChatColumnWidth(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_CUSTOM_CHAT_COLUMN_WIDTH;
  return Math.min(MAX_CHAT_COLUMN_WIDTH, Math.max(MIN_CHAT_COLUMN_WIDTH, Math.round(value)));
}

export interface ChatWidthModeCopy {
  /** Control label. */
  label: string;
  /** One line under the label, in the settings card. */
  description: string;
}

/** Labels for the settings control. Preset numbers stay in CSS — see the header. */
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
  custom: {
    label: 'Custom',
    description: 'The width you dragged. Grab the edge of the transcript and pull it wider or narrower.',
  },
};
