/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Which sessions have a "Rename with AI" request in flight.
 *
 * Module state rather than a flag owned by the hook that fired the request:
 * a rename is started from three places (the sidebar row's menu, the navbar
 * title's menu, the phone's row) and the row being renamed is not always on
 * the surface that started it — the navbar acts on the session on screen,
 * whose sidebar row may be scrolled out of view. A per-caller flag left the
 * other surfaces silent, so the row showed nothing while the title spun and
 * the title showed nothing while the row spun.
 *
 * The read is `useState` + `subscribe` rather than `useSyncExternalStore`, for
 * the reason `list-slots.ts` gives: every row reads its OWN key out of one
 * mutable Set, so there is no single snapshot identity an external store could
 * compare.
 */

import { useEffect, useState } from 'preact/hooks';

const renaming = new Set<string>();
const listeners = new Set<() => void>();

/** Arm (or disarm) one session's in-flight rename. A no-op write emits nothing. */
export function setSessionRenaming(sessionId: string, pending: boolean): void {
  if (renaming.has(sessionId) === pending) return;
  if (pending) renaming.add(sessionId);
  else renaming.delete(sessionId);
  for (const listener of [...listeners]) listener();
}

/** Synchronous read, for the request guard in `useSessionActions`. */
export function isSessionRenaming(sessionId: string): boolean {
  return renaming.has(sessionId);
}

export function subscribeSessionRenaming(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Whether this session has a rename in flight, reactive for a row's spinner. */
export function useSessionRenaming(sessionId: string | number | null | undefined): boolean {
  const key = sessionId == null ? '' : String(sessionId);
  const [pending, setPending] = useState(() => key !== '' && renaming.has(key));

  useEffect(() => {
    if (!key) {
      setPending(false);
      return;
    }
    setPending(renaming.has(key));
    return subscribeSessionRenaming(() => setPending(renaming.has(key)));
  }, [key]);

  return pending;
}
