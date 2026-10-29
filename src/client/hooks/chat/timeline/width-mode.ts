/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The single writer for the chat column's width mode.
 *
 * The mode is an ATTRIBUTE on `<html>`, and CSS is the only consumer: the
 * column's `max-width` comes from the `--chat-column-max` table in
 * `src/client/tailwind.css`. That is why this module exports no hook — nothing
 * in the timeline reads the mode in JavaScript, and a hook would exist only to
 * re-render a subtree that CSS already updates.
 *
 * The attribute is written at boot (`initChatWidthMode`, before the first
 * render) and on every change from the settings modal
 * (`applyChatWidthMode`). A stored value this build cannot draw resolves to the
 * default rather than to an attribute no rule matches — see
 * `resolveChatWidthMode`.
 *
 * There is deliberately no document observer here, unlike `theme.ts`: the theme
 * has runtime consumers that cannot read CSS (the mermaid hydrator repaints
 * diagrams), so it needs an event. A width has none.
 */

import { readKabmoSetting } from '@/shared/lib/settings/client';
import type { SettingsState } from '@/shared/types';
import {
  CHAT_WIDTH_ATTRIBUTE,
  DEFAULT_CHAT_WIDTH_MODE,
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
 * Point the document at `mode`.
 *
 * The default is REMOVED rather than written, so a document carrying `wide`
 * and a document carrying nothing are the same state — which is what makes the
 * `:root` fallback in CSS the single statement of the default width.
 */
export function applyChatWidthMode(mode: unknown): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const resolved = resolveChatWidthMode(mode);
  if (resolved === DEFAULT_CHAT_WIDTH_MODE) root.removeAttribute(CHAT_WIDTH_ATTRIBUTE);
  else root.setAttribute(CHAT_WIDTH_ATTRIBUTE, resolved);
}

/**
 * Apply the stored mode before the first render.
 *
 * Called from `main.tsx` right after `primeKabmoSettings`, because the boot
 * payload is what `readKabmoSetting` answers from. Without it a user on
 * `compact` would see the default column for one frame and then watch it snap
 * narrower.
 */
export function initChatWidthMode(): void {
  applyChatWidthMode(readKabmoSetting<unknown>(CHAT_WIDTH_SETTING_KEY));
}
