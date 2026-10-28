/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The native shell's resume hook, delegated to the page.
 *
 * A backgrounded Android WebView does not reliably deliver the browser events
 * the realtime channel listens for: the document is never reported hidden when
 * the app goes to the background, so returning to it fires no
 * `visibilitychange`, and a socket the server reaped while the page was frozen
 * produces no `close`. The channel's watchdog (`shared/lib/realtime/resume.ts`)
 * repairs that on its own, but only on its next tick — up to 5s, plus a 2s probe
 * — which is the difference between the stream continuing and the user
 * concluding it is dead.
 *
 * So the shell says so directly: `MainActivity.onResume` /
 * `ShellViewController.viewDidAppear` evaluate `window.__kabmoResume()`, and the
 * repair starts on that tick. Same indirection as `__kabmoBack`, and for the
 * same reason — the page owns the state, the shell only knows the moment.
 *
 * Idempotent and safe to call at any time: a healthy connection is probed, a
 * dead one is re-dialed, and a tab with no subscribers does nothing.
 */

import { wake } from '@/shared/lib/realtime/connection';

/** The property the shell calls. Named once so both sides agree. */
export const RESUME_PROPERTY = '__kabmoResume';

/**
 * Install `window.__kabmoResume`. Idempotent — a hot reload re-runs it.
 *
 * Installed unconditionally: the function is inert in a browser (nothing calls
 * it), and gating it on a user agent would be a second place that has to know
 * which shells exist.
 */
export function installResumeDispatcher(): void {
  if (typeof window === 'undefined') return;
  (window as unknown as Record<string, unknown>)[RESUME_PROPERTY] = wake;
}
