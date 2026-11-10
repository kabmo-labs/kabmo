/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * `window.__kabmoOpenSession(sessionId)` — what a native shell calls when the
 * user clicks a notification.
 *
 * A plain function, not a bridge command: the shell has nothing to ask and no
 * answer to wait for, the page already owns the routing state, and the shells
 * reach it with `evaluateJavascript` / `evaluateJavaScript` / `ExecuteScriptAsync`
 * / `run_javascript`. Same indirection as `__kabmoBack` and `__kabmoResume`, and
 * for the same reason: the shell may call it during hydration, so it must exist
 * before the first render.
 */

import { openSessionInUrl } from '@/client/lib/router/open-session';

export const OPEN_SESSION_PROPERTY = '__kabmoOpenSession';

declare global {
  interface Window {
    /** Select the session a notification was about. Returns false for a blank id. */
    __kabmoOpenSession?: (sessionId: string) => boolean;
  }
}

/** Install the dispatcher. Idempotent — a hot reload re-runs it. */
export function installOpenSessionDispatcher(): void {
  if (typeof window === 'undefined') return;
  window[OPEN_SESSION_PROPERTY] = (sessionId) => openSessionInUrl(String(sessionId ?? ''));
}
