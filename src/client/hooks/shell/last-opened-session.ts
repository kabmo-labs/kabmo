/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Cold-start session continuity for the native shells.
 *
 * A shell opens the console's origin with no query, so the page used to answer
 * with its empty workspace — even though the user had a chat open when they
 * closed the app. Two halves fix that, and they live together because they are
 * one rule seen from each side of the launch:
 *
 * - **Restore** runs BEFORE hydration (`main.tsx`), from the id the server read
 *   for this install's `kabmo_client` cookie on the very request that served
 *   this document. A `replaceState` there means the first render already names
 *   the session: no landing flash, and no history entry for a place the user
 *   never chose.
 * - **Record** runs on every URL selection (`App`), so the next launch restores
 *   whatever this one left on screen. The write is keyed by the same cookie, so
 *   a phone, a desktop shell and a browser each keep their own pointer even
 *   when they share one console.
 *
 * Restore is inert outside a shell — `hasShellBridge()` is false in every
 * browser — which is what keeps the browser's landing exactly where it was.
 */

import { useEffect, useRef } from 'preact/hooks';
import { hasShellBridge } from '@/client/lib/shell/transport';
import { openSessionInUrl } from '@/client/lib/router/open-session';
import { useSearchParams } from '@/client/lib/router/search-params';

/**
 * Select the remembered session on a cold start, when this page is inside a
 * native shell and the URL names nothing.
 *
 * Returns whether the URL moved. A deep link that already selected a session
 * wins: the user (or a notification) asked for that one explicitly.
 */
export function restoreLastOpenedSession(sessionId: string | null | undefined): boolean {
  if (typeof window === 'undefined') return false;
  if (!hasShellBridge()) return false;
  const id = typeof sessionId === 'string' ? sessionId.trim() : '';
  if (!id) return false;
  if (new URLSearchParams(window.location.search).get('sessionId')) return false;
  return openSessionInUrl(id, { replace: true });
}

/**
 * Remember every session the URL selects.
 *
 * `enabled` is the authentication state: a page showing the login screen has no
 * session to remember and its endpoint would answer 401.
 *
 * A pending id (`new-…`, `__new__…`) is skipped because there is no session to
 * reopen yet; the spawn's adoption switches the URL to the real id, which this
 * hook records on its next run. A failed POST is deliberately silent: the
 * previous record still describes a session the user actually opened, and
 * there is no action on this screen to report it against.
 */
export function useSessionOpenRecorder(enabled: boolean): void {
  const [searchParams] = useSearchParams();
  const sessionId = searchParams.get('sessionId');
  const sent = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const id = sessionId?.trim();
    if (!id || id.startsWith('new-') || id.startsWith('__new__')) return;
    if (sent.current === id) return;
    sent.current = id;
    void fetch(`/api/sessions/${encodeURIComponent(id)}/opened`, { method: 'POST' }).catch(() => {});
  }, [enabled, sessionId]);
}
