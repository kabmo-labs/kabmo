/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Session-level mutations — rename, rename-with-AI, archive — shared by the
 * sidebar rows and the navbar's session menu.
 *
 * Split out of `useWorkspaceFolderActions`, which had grown both nouns: the
 * FOLDER's own actions (pin, delete, reveal) and the actions on the SESSIONS
 * inside it. The two callers need different halves, and the session half names
 * the same endpoints wherever it runs — the navbar menu must not grow a second
 * implementation that drifts on the URL or on the signal it publishes.
 */

import { publishClientSignal } from '@/client/lib/signals';
import { useFetcher } from '@/client/lib/router/fetcher';
import { isSessionRenaming, setSessionRenaming } from '@/client/hooks/workspace/renaming-sessions';
import type { SessionItemData } from '@/shared/types';

/** Surfaces an outcome to the user; omitted callers stay silent. */
export type ReportSessionOutcome = (message: string, tone?: 'success' | 'error') => void;

export interface SessionActions {
  handleArchive: (session: SessionItemData) => void;
  handleRename: (session: SessionItemData, name: string) => Promise<void>;
  /** Ask omp to name the session from its transcript, reporting the outcome. */
  handleRenameWithAi: (session: SessionItemData) => Promise<void>;
}

export function useSessionActions(refresh: () => void, report?: ReportSessionOutcome): SessionActions {
  const archiveFetcher = useFetcher();

  const handleArchive = (session: SessionItemData) => {
    const nextArchived = session.is_archived !== 1;
    archiveFetcher.submit(
      { archived: String(nextArchived) },
      { method: 'POST', action: `/api/sessions/${session.id}/archive` }
    );
    refresh();
  };

  const handleRename = async (session: SessionItemData, name: string) => {
    try {
      const body = new FormData();
      body.set('name', name);
      const res = await fetch(`/api/sessions/${encodeURIComponent(String(session.id))}/rename`, { method: 'POST', body });
      if (!res.ok) return;
    } catch {
      return;
    }
    publishClientSignal('session-renamed', { sessionId: String(session.id), title: name });
    refresh();
  };

  /**
   * "Rename with AI": omp names the session from its own transcript.
   *
   * Unlike `handleRename` this one has a wait in it (a model call, a few
   * seconds) and can legitimately be refused — a mid-run session, a transcript
   * too thin to title — so the outcome is reported rather than assumed, and
   * the title it produces is announced on the same `session-renamed` signal a
   * manual rename uses, so the navbar follows it without a refetch.
   *
   * The wait is shown as a SPINNER, not a toast: the request can outlive any
   * toast's duration, and a progress notice that vanished while the work went
   * on would read as a finished failure. `setSessionRenaming` marks the session
   * for as long as the request is in flight, and every surface that draws that
   * row — both sidebars and the navbar title — spins its status slot from it,
   * so the cue cannot disagree with itself whichever surface started the
   * rename. The mark is cleared BEFORE the outcome is reported, so the success
   * toast never renders beside a row that is still spinning.
   */
  const handleRenameWithAi = async (session: SessionItemData) => {
    const sessionId = String(session.id);
    // A double click would otherwise fire two generations, and the second
    // would re-derive the title from the transcript the first is naming.
    if (isSessionRenaming(sessionId)) return;
    setSessionRenaming(sessionId, true);
    try {
      const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/rename-with-ai`, { method: 'POST' });
      const data = (await res.json().catch(() => ({}))) as { name?: string; error?: string };
      if (!res.ok || !data.name) {
        report?.(data.error || `Could not generate a name (HTTP ${res.status}).`, 'error');
        return;
      }
      publishClientSignal('session-renamed', { sessionId, title: data.name });
      refresh();
      report?.(`Renamed to "${data.name}".`, 'success');
    } catch (error) {
      report?.(error instanceof Error ? error.message : String(error), 'error');
    } finally {
      setSessionRenaming(sessionId, false);
    }
  };

  return { handleArchive, handleRename, handleRenameWithAi };
}
