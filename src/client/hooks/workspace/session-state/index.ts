import { useEffect, useRef, useState } from 'preact/hooks';
import { getSessionValue, hydrateSession, setSessionKey } from '@/shared/lib/workspace/session-state/store';
import { subscribeSessionKey, subscribeSessionReplaced } from '@/shared/lib/workspace/session-state/listeners';
import { useSessionStateContext } from '@/client/hooks/workspace/session-state/context';

type LoadedState = Record<string, unknown>;

/**
 * Per-session persisted state slot. Restores `fallback` until the session's
 * blob is loaded, then swaps in the stored value; every write is cached and
 * debounced-persisted under the active session id.
 *
 * Returns `[value, setValue, ready]` — `ready` lets panels defer their first
 * fetch/render until restore completed (mirrors the DesktopLayout editor
 * "blip" concern).
 *
 * The copy is PRIVATE by design: two callers of the same key never observe
 * each other's writes (a panel width is owned by one component). It is NOT
 * private about the store being replaced wholesale — a blob landing, or a
 * spawn adoption migrating the pending slot onto the real id — because there
 * the value the copy holds was never written by anyone, it is the fallback
 * this component read on the commit the session id changed. `ready` does not
 * move across an adoption (it was already true), so without the second
 * subscription a pending chat's opened panels and picked view were reset to
 * their defaults at the exact moment the spawn renamed the session.
 */
export function useSessionState<T>(key: string, fallback: T): [T, (value: T | ((prev: T) => T)) => void, boolean] {
  const { sessionId, ready } = useSessionStateContext();
  const stored = getSessionValue<T>(sessionId, key);
  const [local, setLocal] = useState<T>(stored === undefined ? fallback : stored);
  const sessionIdRef = useRef(sessionId);

  // Restore the stored value (or reset to fallback) on session change/load.
  useEffect(() => {
    if (sessionIdRef.current !== sessionId) {
      sessionIdRef.current = sessionId;
    }
    if (!ready) return;
    const next = getSessionValue<T>(sessionId, key);
    setLocal(next === undefined ? fallback : next);
    // `key` and `fallback` are stable per call site; session/ready drive restore.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, ready, key]);

  // The store replaced this session's blob under the copy (a load landing, an
  // adoption migrate, a delete). `ready` may not move, so re-read on the event.
  useEffect(
    () =>
      subscribeSessionReplaced(sessionId, () => {
        const next = getSessionValue<T>(sessionId, key);
        setLocal(next === undefined ? fallback : next);
      }),
    // `key` and `fallback` are stable per call site.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sessionId, key],
  );

  const setValue = (value: T | ((prev: T) => T)) => {
    const resolved = typeof value === 'function' ? (value as (prev: T) => T)(getSessionValue<T>(sessionId, key) ?? local) : value;
    setLocal(resolved);
    setSessionKey(sessionId, key, resolved);
  };

  // While the blob loads, surface the live in-memory value so a panel never
  // renders stale fallback over a fresher local write.
  if (!ready && stored !== undefined && stored !== local) {
    return [stored, setValue, ready];
  }
  return [local, setValue, ready];
}

export const useSessionUiState = useSessionState;

/**
 * A slot read the way EVERY component sees it: the value is read from the store
 * on each render and the hook re-renders whenever any component writes it.
 *
 * `useSessionState` keeps a private copy per caller, so two components reading
 * the same key never observe each other's writes. That is right for state a
 * component owns alone (a draft, a panel width) and wrong for state a surface
 * must FOLLOW without owning it — the Source Control dot tracking the repo the
 * git panel picked — which reads through here instead. Writing is the same:
 * `setValue` persists and notifies.
 */
export function useSharedSessionState<T>(key: string, fallback: T): [T, (value: T | ((prev: T) => T)) => void, boolean] {
  const { sessionId } = useSessionStateContext();
  const [, setValue, ready] = useSessionState<T>(key, fallback);
  const [, bump] = useState(0);
  useEffect(() => subscribeSessionKey(sessionId, key, () => bump((n) => n + 1)), [sessionId, key]);
  const stored = getSessionValue<T>(sessionId, key);
  return [stored === undefined ? fallback : stored, setValue, ready];
}

/** One-shot restore helper for non-hook contexts (event handlers, stores). */
export function useSessionStateSnapshot(): { sessionId: string; ready: boolean; read: <T>(key: string, fallback: T) => T; hydrate: (state: LoadedState) => void } {
  const { sessionId, ready } = useSessionStateContext();
  return {
    sessionId,
    ready,
    read: <T,>(key: string, fallback: T): T => {
      const stored = getSessionValue<T>(sessionId, key);
      return stored === undefined ? fallback : stored;
    },
    hydrate: (state: LoadedState) => hydrateSession(sessionId, state),
  };
}
