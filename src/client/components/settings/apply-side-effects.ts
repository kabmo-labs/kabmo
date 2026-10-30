/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The visual side-effects of a settings edit, applied the moment the value
 * moves.
 *
 * Every one of these settings changes something ALREADY ON SCREEN, and
 * `appSettings` is a boot-time prop the open surfaces only see again after a
 * reload — so the modal has to announce the change, and each consumer
 * subscribes (`useSidebarStyle`, `useToolRenderMode`, `useEditorFont`, …).
 *
 * It lives here rather than inside the modal for two reasons: the modal sits at
 * the repo's 350-line ceiling, and this is a table of "value moved → announce",
 * which has nothing to do with the modal's own job (reading a category,
 * dispatching a write). Adding the sidebar style to a chain of `if`s in the
 * component pushed it over.
 *
 * Two rules, both load-bearing:
 *
 * - **Announce only what moved.** A re-render from an unrelated setting must
 *   not churn every editor's font stack or every timeline's renderer.
 * - **The theme is not an announcement.** It is written to `<html>` through
 *   `applyDocumentTheme`, the one writer, because consumers that cannot read
 *   CSS (the mermaid hydrator) learn about a palette from its event.
 */

import type { SettingsState } from '@/shared/types';
import { applyDocumentTheme } from '@/client/hooks/ui/theme';
import { applyChatWidthMode } from '@/client/hooks/chat/timeline/width-mode';
import { applyToolRenderMode } from '@/client/hooks/chat/timeline/tool-render-mode';
import { applySidebarStyle } from '@/client/hooks/workspace/sidebar-style';
import { EDITOR_FONT_CHANGED_EVENT } from '@/client/hooks/editor/font';
import { EDITOR_THEME_CHANGED_EVENT } from '@/client/hooks/editor/theme';

/**
 * Apply `next` on top of `previous`.
 *
 * `previous` is the snapshot the modal held before the edit, so a caller that
 * passes the same object twice announces nothing — which is what makes an
 * unrelated toggle free.
 */
export function applySettingsSideEffects(previous: SettingsState, next: SettingsState): void {
  if (typeof document !== 'undefined' && next.theme) {
    applyDocumentTheme(next.theme);
  }

  // The editor font is visual, so an open editor has to hear about the change
  // now. Announced only when the value actually moved, so a re-render of an
  // unrelated setting does not churn every editor's stack.
  if (typeof window !== 'undefined' && next.editorFont !== previous.editorFont) {
    window.dispatchEvent(new CustomEvent(EDITOR_FONT_CHANGED_EVENT, { detail: next.editorFont }));
  }

  // Same rule for the editor's colour theme: it is visual, and every open
  // editor subscribes rather than reading the boot-time `appSettings`.
  if (typeof window !== 'undefined' && next.editorTheme !== previous.editorTheme) {
    window.dispatchEvent(new CustomEvent(EDITOR_THEME_CHANGED_EVENT, { detail: next.editorTheme }));
  }

  // The chat column's width is an attribute on `<html>` that CSS reads, so it
  // applies the moment the choice is made.
  if (next.chatWidthMode !== previous.chatWidthMode) {
    applyChatWidthMode(next.chatWidthMode);
  }

  // The tool-render style picks a Preact renderer, so the open timeline has to
  // hear about the change now.
  if (next.toolRenderStyle !== previous.toolRenderStyle) {
    applyToolRenderMode(next.toolRenderStyle);
  }

  // The sidebar style picks a Preact tree for the whole left column, and the
  // sidebar is visible BEHIND this modal — so this is the one setting whose
  // effect the user watches happen.
  if (next.sidebarStyle !== previous.sidebarStyle) {
    applySidebarStyle(next.sidebarStyle);
  }
}
