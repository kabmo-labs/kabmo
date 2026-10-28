/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The Android hardware back button, delegated to the page.
 *
 * The shell asks `window.__kabmoBack()` before it walks WebView history, and
 * that indirection exists because of a real mismatch: Kabmo's phone layout keeps
 * its screens in React state (`MobileLayoutWrapper`'s `currentScreen`), not in
 * the URL. `history.back()` therefore reopens a previous session while leaving
 * the drawer that opened it on screen — the user presses back and the app
 * appears to do something unrelated.
 *
 * Handlers are a STACK, last-registered first: a settings dialog mounted over the
 * layout gets the press before the layout does, which is the order the user sees.
 * Each handler answers whether it consumed the press; the first `true` wins.
 */

export type BackHandler = () => boolean;

/** The property the shell calls. Named once so both sides agree. */
export const BACK_PROPERTY = '__kabmoBack';

const handlers: BackHandler[] = [];

/** Register a handler; the returned function removes it. */
export function registerBackHandler(handler: BackHandler): () => void {
  handlers.push(handler);
  return () => {
    const index = handlers.indexOf(handler);
    if (index >= 0) handlers.splice(index, 1);
  };
}

/**
 * Ask the page to consume a back press.
 *
 * Exported for tests and for a caller that wants the same precedence without the
 * native shell (a keyboard shortcut). Reverse order is the whole contract, and a
 * throwing handler is skipped rather than allowed to strand the user in a screen
 * they cannot leave.
 */
export function dispatchBack(): boolean {
  for (let index = handlers.length - 1; index >= 0; index -= 1) {
    try {
      if (handlers[index]()) return true;
    } catch {
      // Fall through to the next handler; history is the final fallback.
    }
  }
  return false;
}

/** Install `window.__kabmoBack`. Idempotent — a hot reload re-runs it. */
export function installBackDispatcher(): void {
  if (typeof window === 'undefined') return;
  (window as unknown as Record<string, unknown>)[BACK_PROPERTY] = dispatchBack;
}
