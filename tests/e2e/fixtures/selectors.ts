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
  /**
   * The editor column's scroll container.
   *
   * It is CodeMirror's own scroller (`view.scrollDOM`), not a wrapper the panel
   * renders: the surface owns its scrolling now, so the panel has no scroll
   * container to mark.
   */
  editorScroller: 'editor-scroller',
  diffScroller: 'diff-scroller',
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
