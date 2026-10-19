/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Sidebar session stream status — server-authoritative via SQLite.
 *
 * The status rides the realtime `sidebar:status` topic, so the spinner and
 * check update with the list they belong to. Opening a session acknowledges the one-shot terminal badge
 * (`finish` / `abort` / `error`) via POST /api/sessions/:id/stream-seen so
 * the check shows exactly once, then disappears from the rendered list.
 *
 * A run in flight is reported by ONE source: the `stream` row the server writes
 * at prompt dispatch (`session_stream_state`). There is deliberately no
 * client-side optimistic mark — a second writer that the client owned the
 * lifecycle of is exactly what left a spinner and a generating indicator
 * turning after the run had ended (a mark armed under one session id and
 * released under another is never released at all).
 */

import { useEffect, useRef } from 'preact/hooks';
import type { SessionItemData } from '@/shared/types';

export type SessionStreamStatus = NonNullable<SessionItemData['streamStatus']>;

/** Derive { sessionId → status } from the loader-provided folders. */
export function buildSidebarSessionStatus(
  folders: { sessions?: SessionItemData[] }[],
): Record<string, SessionStreamStatus> {
  const map: Record<string, SessionStreamStatus> = {};
  for (const folder of folders) {
    for (const session of folder.sessions ?? []) {
      if (session.streamStatus) map[String(session.id)] = session.streamStatus;
    }
  }
  return map;
}

/**
 * Whether the session item for `sessionId` currently draws the run spinner —
 * the exact `status === 'stream'` test `SessionItem` / `SessionRow` render
 * `Loader2` from.
 *
 * The chat timeline's generating indicator asks THIS, so the two surfaces
 * cannot disagree about whether a run is in flight. The status row is
 * server-authoritative and lives in the shared database, so it is the only
 * condition that holds for a run this client did not start: a second tab, a
 * second Kabmo instances, or a page that never attached to the session's
 * event stream (`GET /api/agent/:id` answers `running: false` for a child
 * owned by another process, so no `onResumeStream` fires here).
 */
export function isSessionStreaming(
  statusMap: Record<string, SessionStreamStatus | undefined> | null | undefined,
  sessionId: string | number | null | undefined,
): boolean {
  if (sessionId === null || sessionId === undefined) return false;
  return statusMap?.[String(sessionId)] === 'stream';
}

/**
 * Whether a CHAT has a run in flight — the one definition the docked
 * generating indicator, the Stop button and the withheld run footer read.
 *
 * The server's `stream` row is the answer, exactly as it is for the sidebar
 * spinner: one source, so the two surfaces cannot disagree. The single
 * exception is a run the server cannot NAME yet — a pending `new-…` chat has no
 * omp id until the spawn answers, so there is no row to carry and nothing on
 * the server can report it. `pendingRun` covers exactly that window and is
 * supplied by the caller, which is the only place that knows the id is still
 * pending; it is never a general-purpose optimistic mark.
 */
export function isChatRunning(
  statusMap: Record<string, SessionStreamStatus | undefined> | null | undefined,
  sessionId: string | number | null | undefined,
  pendingRun: boolean,
): boolean {
  return pendingRun || isSessionStreaming(statusMap, sessionId);
}

/**
 * Opening a session with a terminal badge acknowledges it on the server
 * (one POST per session+status) so the check shows EXACTLY ONCE: the badge
 * keeps rendering on this pass — stripping it here would suppress the paint
 * entirely for an open session. Once the POST lands, a revalidate pulls
 * loader data without the deleted row, dropping the check from the list.
 *
 * Click paths call `markSeen` (optimistic strip + ack) BEFORE the status map
 * can even carry the badge; `skip` lets the caller suppress this effect for
 * sessions the click already handled, so the two never double-POST.
 */
export function useSessionStatusAck(
  statusMap: Record<string, SessionStreamStatus>,
  activeSessionId: number | string | null,
  revalidate: () => void,
  skip?: (sessionId: number | string) => boolean,
): void {
  const activeId = activeSessionId === null ? null : String(activeSessionId);
  const activeStatus = activeId !== null ? statusMap[activeId] : undefined;
  // One POST per (session, status): between the ack and the revalidate that
  // drops the row, identity changes in statusMap would re-fire the effect.
  const ackedRef = useRef<string | null>(null);
  const revalidateRef = useRef(revalidate);
  revalidateRef.current = revalidate;
  const skipRef = useRef(skip);
  skipRef.current = skip;

  useEffect(() => {
    if (!activeStatus || activeStatus === 'stream') return;
    if (skipRef.current?.(activeId as string)) return;
    const ackKey = `${activeId}:${activeStatus}`;
    if (ackedRef.current === ackKey) return;
    ackedRef.current = ackKey;
    // Stale-map guard: statusMap can lag a busy list by up to one fetch. If
    // the badge was actually overwritten by a fresh `stream` (agent_start
    // raced the sidebar refetch), the server now refuses to delete the row
    // and reports deleted:false — treat the POST as void so the effect can
    // re-ack the real terminal badge when the run later ends.
    fetch(`/api/sessions/${encodeURIComponent(activeId as string)}/stream-seen`, { method: 'POST' })
      .then((res) => res.json() as Promise<{ deleted?: boolean }>)
      .then((body) => {
        if (body.deleted === false) ackedRef.current = null;
        revalidateRef.current();
      })
      .catch(() => {
        ackedRef.current = null;
      });
  }, [activeId, activeStatus]);
}
