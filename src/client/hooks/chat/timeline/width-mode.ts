/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The single writer for the chat column's width.
 *
 * The preset mode is an ATTRIBUTE on `<html>` and the dragged width is an
 * inline custom property on the same element; CSS is the only consumer: the
 * column's `max-width` comes from `--chat-column-max` in
 * `src/client/tailwind.css`, overridden inline for `custom`. That is why this
 * module exports no hook — nothing in the timeline reads the width in
 * JavaScript, and a hook would exist only to re-render a subtree that CSS
 * already updates. The two places that need the NUMBER are the drag handle (it
 * measures the DOM and writes through `commitChatColumnWidth`) and the settings
 * card (it reads the stored value).
 *
 * The attribute is written at boot (`initChatWidthMode`, before the first
 * render) and on every change — from the settings modal
 * (`applyChatWidthMode`) and from a drag (`commitChatColumnWidth`). A stored
 * value this build cannot draw resolves to the default rather than to an
 * attribute no rule matches — see `resolveChatWidthMode`.
 *
 * There is deliberately no document observer here, unlike `theme.ts`: the theme
 * has runtime consumers that cannot read CSS (the mermaid hydrator repaints
 * diagrams), so it needs an event. A width has none.
 */

import { readKabmoSetting, writeKabmoSettings } from '@/shared/lib/settings/client';
import type { SettingsState } from '@/shared/types';
import {
  CHAT_COLUMN_MAX_VAR,
  CHAT_WIDTH_ATTRIBUTE,
  DEFAULT_CHAT_WIDTH_MODE,
  resolveChatColumnWidth,
  resolveChatWidthMode,
} from '@/shared/lib/chat/timeline/width-mode';

/**
 * `app_settings` key holding the mode (in the `kabmo_settings` blob).
 *
 * `satisfies keyof SettingsState` because the key and the field name must be
 * the same string for persistence to work at all — renaming the field without
 * this line would leave the setting silently unsaved.
 */
export const CHAT_WIDTH_SETTING_KEY = 'chatWidthMode' satisfies keyof SettingsState;

/**
 * The stored pixel width of a `custom` column. Kept even while a preset is
 * active, so switching back to Custom restores the width the user dragged
 * instead of a placeholder.
 */
export const CHAT_COLUMN_WIDTH_SETTING_KEY = 'chatColumnWidth' satisfies keyof SettingsState;

/**
 * Point the document at `mode`, with `width` as the number behind `custom`.
 *
 * The default is REMOVED rather than written, so a document carrying `wide`
 * and a document carrying nothing are the same state — which is what makes the
 * `:root` fallback in CSS the single statement of the default width. The inline
 * custom property is removed for every preset for the same reason: a leftover
 * `--chat-column-max: 1120px` on `<html>` would beat every preset rule, because
 * an inline declaration outranks a stylesheet one.
 */
export function applyChatWidthMode(mode: unknown, width?: unknown): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const resolved = resolveChatWidthMode(mode);
  root.style.removeProperty(CHAT_COLUMN_MAX_VAR);

  if (resolved === 'custom') {
    root.setAttribute(CHAT_WIDTH_ATTRIBUTE, 'custom');
    root.style.setProperty(CHAT_COLUMN_MAX_VAR, `${resolveChatColumnWidth(width)}px`);
    return;
  }

  if (resolved === DEFAULT_CHAT_WIDTH_MODE) root.removeAttribute(CHAT_WIDTH_ATTRIBUTE);
  else root.setAttribute(CHAT_WIDTH_ATTRIBUTE, resolved);
}

/**
 * Draw a width while the pointer is still moving, WITHOUT storing it.
 *
 * The drag itself owns this: every `pointermove` repaints the transcript and
 * the composer (one CSS variable), and only the release persists. Persisting
 * per frame would POST to `/api/settings` dozens of times for a width the user
 * is still choosing.
 *
 * Deliberately silent about the mode attribute: a drag is a `custom` width, but
 * a drag that is abandoned (`pointercancel`, a window blur) must leave the
 * stored preset intact, and the attribute is what the next render resolves
 * against.
 */
export function previewChatColumnWidth(px: number): void {
  if (typeof document === 'undefined') return;
  document.documentElement.style.setProperty(CHAT_COLUMN_MAX_VAR, `${resolveChatColumnWidth(px)}px`);
}

/**
 * Commit a dragged width: `custom` mode plus its number, applied and stored.
 *
 * Both keys travel in ONE patch. Writing the mode first and the width second
 * leaves a window (and a failed second request) where the document claims
 * `custom` while the stored number is an older one — the column would jump on
 * the next reload with no gesture to explain it.
 */
export function commitChatColumnWidth(px: number): number {
  const width = resolveChatColumnWidth(px);
  writeKabmoSettings({ [CHAT_WIDTH_SETTING_KEY]: 'custom', [CHAT_COLUMN_WIDTH_SETTING_KEY]: width });
  applyChatWidthMode('custom', width);
  return width;
}

/**
 * Apply the stored width before the first render.
 *
 * Called from `main.tsx` right after `primeKabmoSettings`, because the boot
 * payload is what `readKabmoSetting` answers from. Without it a user on
 * `compact` (or on a dragged `custom` width) would see the default column for
 * one frame and then watch it snap.
 */
export function initChatWidthMode(): void {
  applyChatWidthMode(
    readKabmoSetting<unknown>(CHAT_WIDTH_SETTING_KEY),
    readKabmoSetting<unknown>(CHAT_COLUMN_WIDTH_SETTING_KEY),
  );
}

/**
 * Put the document back on the STORED width, discarding a live preview.
 *
 * A drag paints the variable and stores nothing, so a gesture that ends without
 * a commit (a cancelled pointer, a click on the grip with no movement, a window
 * that lost the pointer) leaves an inline value that outranks every preset
 * rule. Re-applying the stored mode is the one way back, and it is why the
 * preview lives in this module rather than in the hook.
 */
export function restoreChatColumnWidth(): void {
  initChatWidthMode();
}
