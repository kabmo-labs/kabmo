/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Panel-facing hooks: what a view is rendered with, and how it reads the
 * chamber's own state.
 *
 * These are the pieces a built-in panel and a plugin panel both need, and the
 * reason they live in the published kit is that the alternative — each panel
 * re-deriving them — is how the chamber's eleven views drifted apart in the
 * first place.
 */

import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { requireServices, type PanelContext } from './services';

/**
 * The live panel context, re-rendering on every change.
 *
 * `useState` is seeded from the service and updated by its subscription, which
 * is what makes a workspace that arrives after the first paint show up.
 */
export function usePanelInfo(): PanelContext {
  const [context, setContext] = useState<PanelContext>(() => requireServices().context());

  useEffect(() => {
    const api = requireServices();
    setContext(api.context());
    return api.subscribe(setContext);
  }, []);

  return context;
}

/** The live palette id. */
export function useTheme(): string {
  return usePanelInfo().theme;
}

export interface SessionValue {
  /** `null` until the read answers — the field should be disabled, not empty. */
  value: string | null;
  status: 'loading' | 'idle' | 'saving' | 'saved' | 'error';
  error: string | null;
  update: (next: string) => void;
}

/**
 * Per-session state, as a `useState` that persists.
 *
 * The write is debounced: `onInput` fires per keystroke, and each one would
 * otherwise be a store write and a request.
 */
export function useSessionValue(key: string, delayMs = 400): SessionValue {
  const { sessionId } = usePanelInfo();
  const [value, setValue] = useState<string | null>(null);
  const [status, setStatus] = useState<SessionValue['status']>('loading');
  const [error, setError] = useState<string | null>(null);
  // Distinguishes "this component's own edit" from "someone else wrote the
  // slot". Only the former may set `saving`, or an unrelated write would mark a
  // field dirty and write it straight back.
  const editing = useRef(false);

  const read = useCallback((): string => {
    try {
      const stored = requireServices().getSessionValue(sessionId, key) ?? '';
      setError(null);
      return stored;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setStatus('error');
      return '';
    }
  }, [sessionId, key]);

  useEffect(() => {
    editing.current = false;
    setStatus('loading');
    setValue(read());
    setStatus((current) => (current === 'error' ? current : 'idle'));
  }, [read]);

  // Follow writes from anywhere else — the header readout showing a note's
  // length, a second view of the same value. Skipped while THIS component is
  // mid-edit, because its own state is the newer truth until the debounce lands.
  useEffect(() => {
    const api = requireServices();
    if (!api.subscribeSessionValue) return;
    return api.subscribeSessionValue(sessionId, key, () => {
      if (editing.current) return;
      setValue(read());
    });
  }, [sessionId, key, read]);

  useEffect(() => {
    if (value === null || status !== 'saving') return;
    const timer = setTimeout(() => {
      try {
        requireServices().setSessionValue(sessionId, key, value);
        editing.current = false;
        setStatus('saved');
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
        setStatus('error');
      }
    }, delayMs);
    return () => clearTimeout(timer);
  }, [sessionId, key, value, status, delayMs]);

  const update = useCallback((next: string) => {
    editing.current = true;
    setValue(next);
    setStatus('saving');
  }, []);

  return { value, status, error, update };
}

export interface WorkspaceFile {
  content: string | null;
  loading: boolean;
  error: string | null;
}

/**
 * Per-session state of any JSON shape, persisted by the chamber's store.
 *
 * The `useState`-with-persistence contract, for a value that is not a string: a
 * collapsed-phase map, a picked file. `ready` is false until the session's blob
 * has loaded, so a view can hold its first render rather than paint a fallback
 * over a value that is on its way.
 */
export function useSessionState<T>(
  key: string,
  fallback: T,
): [T, (value: T | ((prev: T) => T)) => void, boolean] {
  const { sessionId } = usePanelInfo();
  const [ready, setReady] = useState(false);
  const [local, setLocal] = useState<T>(() => requireServices().getSessionJson?.<T>(sessionId, key) ?? fallback);

  const read = useCallback(() => {
    const stored = requireServices().getSessionJson?.<T>(sessionId, key);
    setLocal(stored === undefined ? fallback : stored);
  }, [sessionId, key, fallback]);

  useEffect(() => {
    setReady(true);
    read();
  }, [read]);

  // Follow writes from anywhere else, the same reason `useSessionValue` does:
  // two readers of one key must not hold two private copies of the same fact.
  useEffect(() => {
    const api = requireServices();
    if (!api.subscribeSessionJson) return;
    return api.subscribeSessionJson(sessionId, key, read);
  }, [sessionId, key, read]);

  const setValue = useCallback(
    (value: T | ((prev: T) => T)) => {
      const api = requireServices();
      const current = api.getSessionJson?.<T>(sessionId, key) ?? fallback;
      const resolved = typeof value === 'function' ? (value as (prev: T) => T)(current) : value;
      setLocal(resolved);
      api.setSessionJson?.(sessionId, key, resolved);
    },
    [sessionId, key, fallback],
  );

  return [local, setValue, ready];
}

/** Read one text file inside the active workspace. */
export function useWorkspaceFile(relativePath: string): WorkspaceFile {
  const { workspacePath } = usePanelInfo();
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    requireServices()
      .readWorkspaceFile(workspacePath, relativePath)
      .then(
        (text) => {
          if (cancelled) return;
          setContent(text);
          setLoading(false);
        },
        (cause: unknown) => {
          if (cancelled) return;
          setError(cause instanceof Error ? cause.message : String(cause));
          setLoading(false);
        },
      );
    return () => {
      cancelled = true;
    };
  }, [workspacePath, relativePath]);

  return { content, loading, error };
}
