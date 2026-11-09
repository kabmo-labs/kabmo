/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Fork the current chat at a clicked row.
 *
 * The API call and the navigation live together because the refusal has to be
 * shown where the action was taken. The server answers a typed code and a
 * message; the hook surfaces the message and never navigates on a failure —
 * a silent tip fork would be worse than the error.
 */

import { useCallback } from 'preact/hooks';

type ToastKind = 'success' | 'error';

export function useForkSession(
  sessionId: string | null | undefined,
  pushToast: (message: string, type?: ToastKind) => void,
): (messageId: string) => Promise<void> {
  return useCallback(
    async (messageId: string) => {
      if (!sessionId) return;
      try {
        const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/fork`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ anchorEntryId: messageId }),
        });
        const body = (await response.json().catch(() => null)) as
          | { sessionId?: string; error?: string }
          | null;
        if (!response.ok || !body?.sessionId) {
          pushToast(body?.error ?? 'Could not fork this session.', 'error');
          return;
        }
        // A full navigation is deliberate: the fork is a different session with
        // its own transcript, and the workspace's session param is the source of
        // truth the sidebar and the composer read on mount.
        window.location.assign(`/?sessionId=${encodeURIComponent(body.sessionId)}`);
      } catch {
        pushToast('Could not fork this session.', 'error');
      }
    },
    [sessionId, pushToast],
  );
}
