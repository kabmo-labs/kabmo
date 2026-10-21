/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The one place a spec names something in the UI.
 *
 * Two rules, and they are the whole reason this file exists rather than a
 * literal in each spec.
 *
 * 1. **Role + accessible name first.** The Kabmo's toolbars already carry a
 *    `title` and an `aria-label` on every icon-only button (a bare `<svg
 *    onClick>` is unreachable by keyboard, so the app was built the other way
 *    round), which makes `getByRole('button', { name: 'Save' })` both stable
 *    and honest — it asserts the surface is still reachable, not merely that a
 *    node exists. Measured: `src/` has 210 `aria-label` attributes across 99
 *    files and ZERO `data-testid`.
 *
 * 2. **`data-testid` only where no stable accessible name exists** — a
 *    container to scope a query, a virtualized row, an xterm canvas. Those are
 *    added as part of the spec that needs them, never speculatively, and the
 *    name is a stable domain word (`session-item`, `chat-timeline`), not
 *    layout detail.
 *
 * A selector that has to change when a label is reworded is a selector that
 * was never about behaviour; when one of these breaks, the fix is usually to
 * ask whether the element still has an accessible name at all.
 */

import type { Page } from '@playwright/test';

/** Testids the app exposes for this layer. Kept as data so the set is greppable. */
export const TESTID = {
  appRoot: 'app-root',
  sessionSidebar: 'session-sidebar',
  sessionItem: 'session-item',
  chatTimeline: 'chat-timeline',
  composerInput: 'composer-input',
  rightPanel: 'right-panel',
  /** The editor column's scroll container (and the diff views' — same id). */
  editorScroller: 'editor-scroller',
  diffScroller: 'diff-scroller',
  /**
   * The composer's "wait for session" control and its dropdown rows.
   *
   * Both are needed, and neither can be addressed by role alone: the trigger's
   * accessible name CHANGES with the pick ("Wait for session" → "Waiting for
   * <title>"), and a candidate's title also appears on the sidebar row of the
   * session it names — so a `getByRole('button', { name: /session A/i })`
   * resolves to the sidebar, and clicking it opens the dependency instead of
   * choosing it. Measured in `waiting-prompt.e2e.ts`.
   */
  waitPicker: 'wait-picker',
  waitCandidate: 'wait-candidate',
  /**
   * The strip above the composer while a prompt is held, and its Cancel.
   *
   * By testid rather than by name: the word "Cancel" is also a row's, and the
   * strip's own `✕` controls are unnamed — `getByRole('button', { name: /cancel/i
   * }).first()` resolved to an unnamed one and clicked nothing.
   */
  cancelHeldPrompt: 'cancel-held-prompt',
} as const;

/** Locators for the shell and the chat surface, resolved per page. */
export function shell(page: Page) {
  return {
    root: page.locator(`[data-testid="${TESTID.appRoot}"]`),
    sidebar: page.locator(`[data-testid="${TESTID.sessionSidebar}"]`),
  };
}

export function composer(page: Page) {
  return {
    input: page.locator(`[data-testid="${TESTID.composerInput}"]`),
    send: page.getByRole('button', { name: /^send$/i }),
    stop: page.getByRole('button', { name: /stop/i }),
  };
}

export function sidebar(page: Page) {
  return {
    items: page.locator(`[data-testid="${TESTID.sessionItem}"]`),
    newChat: page.getByRole('button', { name: /new chat/i }),
  };
}

export function chat(page: Page) {
  return {
    timeline: page.locator(`[data-testid="${TESTID.chatTimeline}"]`),
    userRows: page.locator('[data-message-role="user"]'),
    aiRows: page.locator('[data-message-role="ai"]'),
  };
}
