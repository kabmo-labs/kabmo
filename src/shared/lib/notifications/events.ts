/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * One system-notification event, on the wire between the server and whichever
 * consumer posts it.
 *
 * Shared by both ends for the same reason the realtime frames are: the server
 * records it, the browser page reads it off the realtime topic, and the Android
 * watcher parses the same shape out of its SSE stream. Three readers, one
 * definition — a field renamed on one side is otherwise a silently empty banner.
 *
 * `id` is a monotonic cursor: a consumer resumes from the last id it saw, which
 * is what makes "never announce a backlog twice" a property of the transport
 * rather than a rule every consumer has to remember.
 */

export type NotificationKind = 'finish' | 'error' | 'ask';

export interface NotificationEvent {
  id: number;
  kind: NotificationKind;
  sessionId: string;
  /** The banner's title: the session's name at the moment the run settled. */
  title: string;
  /** The body: the failure reason, or the event's own sentence. */
  body: string;
  /** Epoch milliseconds of the event itself — the banner's own timestamp. */
  at: number;
  /**
   * How long the run took, when the server knows its start.
   *
   * Absent for an `ask` (a question has no duration) and for a finish whose
   * `stream` row predates the column. Android renders it as the shade's subtext;
   * a surface without that slot simply omits it.
   */
  durationMs?: number;
}

/** The stable notification tag: one banner per session per kind, replaced. */
export function notificationTag(event: Pick<NotificationEvent, 'kind' | 'sessionId'>): string {
  return `${event.kind}:${event.sessionId}`;
}

/**
 * One event from a realtime frame's payload, or null.
 *
 * The guard is shared rather than living in the hook so the wire shape has one
 * definition: a payload missing an id could not advance a cursor, and one
 * missing a session could not open anything on a tap — both are refused here
 * instead of posting a banner that names nothing.
 */
export function asNotificationEvent(payload: unknown): NotificationEvent | null {
  if (!payload || typeof payload !== 'object') return null;
  const candidate = payload as Partial<NotificationEvent>;
  if (typeof candidate.id !== 'number' || typeof candidate.sessionId !== 'string') return null;
  if (candidate.kind !== 'finish' && candidate.kind !== 'error' && candidate.kind !== 'ask') return null;
  return {
    id: candidate.id,
    kind: candidate.kind,
    sessionId: candidate.sessionId,
    title: typeof candidate.title === 'string' ? candidate.title : '',
    body: typeof candidate.body === 'string' ? candidate.body : '',
    at: typeof candidate.at === 'number' ? candidate.at : 0,
    ...(typeof candidate.durationMs === 'number' && candidate.durationMs > 0
      ? { durationMs: candidate.durationMs }
      : {}),
  };
}

/**
 * The characters a notification surfaces can actually draw.
 *
 * A session title is arbitrary text — operators paste Nerd Font glyphs, Powerline
 * separators and icon fonts into names, because a terminal-wide font draws them.
 * Android's notification shade uses the SYSTEM font (Roboto), which has no
 * coverage for any of them, so a Nerd Font icon becomes a tofu box in the banner
 * and in the shade. The same is true of any PUA-icon font on any platform, so
 * the glyphs are removed where the event is built rather than per surface.
 *
 * Removed, and nothing else:
 *
 * - the three Private Use Areas (`U+E000–U+F8FF`, planes 15 and 16) — Nerd Font,
 *   Powerline and icon fonts live here;
 * - variation selectors (`U+FE00–U+FE0F`, `U+E0100–U+E01EF`), which only modify a
 *   glyph that is no longer there;
 * - zero-width space/joiner controls and the BOM, which an icon-only title would
 *   leave behind as invisible text.
 *
 * Emoji, CJK and ordinary punctuation survive: they have real glyphs.
 */
const UNRENDERABLE = /[\uE000-\uF8FF\u{F0000}-\u{FFFFD}\u{100000}-\u{10FFFD}\uFE00-\uFE0F\u{E0100}-\u{E01EF}\u200B-\u200D\uFEFF]/gu;

/**
 * Text as a banner can draw it: unrenderable glyphs gone, whitespace collapsed.
 *
 * Collapsing is part of the same job — an icon between two words leaves a double
 * space, and a body that was several lines of log becomes one readable line.
 */
export function notificationText(text: string): string {
  return text.replace(UNRENDERABLE, ' ').replace(/\s+/g, ' ').trim();
}
