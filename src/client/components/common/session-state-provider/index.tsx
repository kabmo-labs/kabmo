import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { ReactNode } from 'preact/compat';
import { flushSession, loadSession, migrateSessionState, recordSessionOpen } from '@/shared/lib/workspace/session-state/store';
import { consumeAdoption } from '@/client/hooks/chat/omp/pending-sessions';
import { SessionStateContext } from '@/client/hooks/workspace/session-state/context';

/**
 * Mounts once above the workspace panels and drives the per-session UI state
 * lifecycle: load the stored blob when the session changes, flush pending
 * writes before switching, and migrate a pending `new-…` chat's state onto
 * the real id adopted by a spawn. Consumers read/write through
 * `useSessionState(key, fallback)`.
 *
 * A pending `new-…` slot is loaded like any other, because it is PERSISTED
 * like any other: the id is what the URL carries (`?sessionId=new-…`), so a
 * reload of a pending chat — a dev-HMR reload, or a second tab — re-enters it
 * with a row already on the server. Treating it as "nothing stored yet" showed
 * every fallback there (the repo picker reset to the workspace root, the right
 * panel jumped back to its default) and let the next write destroy the stored
 * blob, because the persist body is the WHOLE in-memory map.
 */
export function SessionStateProvider({ sessionId, children }: { sessionId: string | null; children: ReactNode }) {
  const effectiveSessionId = sessionId || '1';
  const [ready, setReady] = useState(false);
  const prevSessionIdRef = useRef<string | null>(null);

  useEffect(() => {
    const prev = prevSessionIdRef.current;
    prevSessionIdRef.current = effectiveSessionId;
    if (prev === effectiveSessionId) return;
    // Every distinct session the user opens is a "last opened" data point —
    // the picker recency window and the cache TTL both hang off it.
    recordSessionOpen(effectiveSessionId);

    // Spawn adoption ("new-…" → real UUID): carry the pending state over
    // instead of loading (nothing is stored under the real id yet). Gated on a
    // RECORDED adoption, because every move away from a pending id looks the
    // same here — clicking another session is not an adoption, and migrating on
    // it copied the pending chat's draft into that session (measured: a POST for
    // the other session carrying `chat.draft`).
    if (prev && prev.startsWith('new-') && !effectiveSessionId.startsWith('new-') && consumeAdoption(prev, effectiveSessionId)) {
      migrateSessionState(prev, effectiveSessionId);
      setReady(true);
      return;
    }

    setReady(false);
    void flushSession(prev).then(() => loadSession(effectiveSessionId)).then(() => {
      // The session may have switched again while loading; only surface readiness.
      if (prevSessionIdRef.current === effectiveSessionId) setReady(true);
    });
  }, [effectiveSessionId]);

  const value = useMemo(
    () => ({ sessionId: effectiveSessionId, ready }),
    [effectiveSessionId, ready],
  );

  return <SessionStateContext.Provider value={value}>{children}</SessionStateContext.Provider>;
}
