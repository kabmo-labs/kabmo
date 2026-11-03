/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Closing one of the agent's browser tabs, from the panel.
 *
 * The server owns the rules (ownership, what CDP does to a screencast session);
 * this hook owns only the client's half: refuse a second close while one is in
 * flight, surface the refusal in words, and return the tab the panel should
 * watch next so the strip does not jump to an unrelated page.
 *
 * Deliberately NOT optimistic: the tab strip is server state (the viewer's
 * owned-target list), so removing a row before the browser confirms would show
 * a tab that still exists — and a failed close would look like a refresh race.
 */

import { useCallback, useState } from 'preact/hooks';

export interface CloseTabResult {
  ok: boolean;
  /** The tab to select once `targetId` is gone (null when none is left). */
  next: string | null;
  error?: string;
}

interface TabsCloseReply {
  ok?: unknown;
  error?: unknown;
  next?: unknown;
}

function readNext(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

export function useCloseBrowserTab(sessionId: string | undefined) {
  const [closing, setClosing] = useState<string | null>(null);

  const closeTab = useCallback(
    async (targetId: string): Promise<CloseTabResult> => {
      if (!sessionId || !targetId) return { ok: false, next: null, error: 'No tab to close' };
      setClosing(targetId);
      try {
        const response = await fetch(`/api/browser/${encodeURIComponent(sessionId)}/tabs/close`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ targetId }),
        });
        const body = (await response.json().catch(() => ({}))) as TabsCloseReply;
        if (!response.ok) {
          const error = typeof body.error === 'string' && body.error ? body.error : `Close failed (${response.status})`;
          return { ok: false, next: null, error };
        }
        return { ok: true, next: readNext(body.next) };
      } catch (error) {
        return { ok: false, next: null, error: error instanceof Error ? error.message : String(error) };
      } finally {
        setClosing(null);
      }
    },
    [sessionId],
  );

  return { closeTab, closing };
}
