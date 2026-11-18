/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The server list the SHELL owns, as the console reads it.
 *
 * One store per window, not per component: the navbar chip, the phone drawer's
 * chip, the popover and anything else that asks "which server am I on" must not
 * each hold a copy — two copies is how a start on one side leaves the other
 * showing `Stopped`.
 *
 * Every mutation answers with the WHOLE state (`ServersState`), and the shell is
 * the source of truth: it re-reads its own list, re-probes every URL and
 * re-discovers local instances before answering. Adopting the response verbatim
 * is what keeps the panel from inventing a running state the shell does not
 * agree with.
 *
 * `available` is `hasShellBridge()` and not `isDesktopShell()`: a phone answers
 * the same four commands the desktop shells do, so it must get the same control.
 */

import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import {
  activateServer,
  addRemoteServer,
  readServers,
  removeServer,
  startLocalServer,
  stopLocalServer,
  type ShellServersState,
} from '@/client/lib/shell/servers';
import { bridgeError, hasShellBridge } from '@/client/lib/shell/transport';

export interface ShellServersStore {
  available: boolean;
  state: ShellServersState | null;
  /** A request is in flight; the panel disables its controls rather than queueing. */
  busy: boolean;
  /** A MANUAL refresh is in flight; the button spins. The 4-second poll does not. */
  refreshing: boolean;
  error: string | null;
  reload: () => Promise<void>;
  /** Re-read the list for the refresh button, with a visible spin. */
  refresh: () => Promise<void>;
  dismissError: () => void;
  activate: (id: string) => Promise<boolean>;
  add: (label: string, url: string) => Promise<boolean>;
  remove: (id: string) => Promise<boolean>;
  start: (port?: number) => Promise<boolean>;
  stop: (id: string) => Promise<boolean>;
}

/**
 * How often the open popover re-reads the list.
 *
 * A local server started in a terminal, a `bun run dev` coming up, a managed
 * one that just died — none of those announce themselves to this page, and the
 * popover is the surface that has to show them. Only while it is open: a poll
 * running behind a closed popover would probe every server every few seconds
 * for a panel nobody is looking at.
 */
const REFRESH_INTERVAL_MS = 4000;

/**
 * How long the refresh button keeps spinning, at minimum.
 *
 * A local list answers in a few milliseconds, so a spin tied only to the request
 * would be over before the eye caught it and the button would read as dead. The
 * floor is feedback, not a delay: the read has already happened, and the button
 * is disabled for exactly as long as it is drawn as working.
 */
const MIN_REFRESH_MS = 400;

export function useShellServers(open: boolean): ShellServersStore {
  const available = hasShellBridge();
  const [state, setState] = useState<ShellServersState | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A mutation and a poll can overlap; the poll must not overwrite the answer
  // the user's own click produced. The counter is what tells them apart.
  const mutationsRef = useRef(0);

  const read = useCallback(async () => {
    if (!available) return;
    const ticket = mutationsRef.current;
    try {
      const next = await readServers();
      if (mutationsRef.current === ticket) setState(next);
    } catch (err) {
      if (mutationsRef.current === ticket) setError(bridgeError(err));
    }
  }, [available]);

  const reload = useCallback(() => read(), [read]);

  const refresh = useCallback(async () => {
    if (!available) return;
    setRefreshing(true);
    const started = Date.now();
    try {
      await read();
    } finally {
      const remaining = MIN_REFRESH_MS - (Date.now() - started);
      if (remaining > 0) {
        const { promise, resolve } = Promise.withResolvers<void>();
        setTimeout(resolve, remaining);
        await promise;
      }
      setRefreshing(false);
    }
  }, [available, read]);

  const dismissError = useCallback(() => setError(null), []);

  const run = useCallback(
    async (action: () => Promise<ShellServersState>) => {
      mutationsRef.current += 1;
      setBusy(true);
      setError(null);
      try {
        setState(await action());
        return true;
      } catch (err) {
        setError(bridgeError(err));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (!available) return;
    void reload();
  }, [available, reload]);

  // The error belongs to the panel session that produced it. Closing the panel
  // is the user saying they are done with it; keeping the sentence for the next
  // open is how a failed Start left a warning on screen until the page reloaded.
  useEffect(() => {
    if (!open) setError(null);
  }, [open]);

  useEffect(() => {
    if (!available || !open) return;
    const timer = setInterval(() => void reload(), REFRESH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [available, open, reload]);

  const activate = useCallback(
    // The shell NAVIGATES on success, so this page is replaced and the resolved
    // state never renders. A failure is what comes back here.
    (id: string) => run(() => activateServer(id)),
    [run],
  );

  const add = useCallback(
    (label: string, url: string) => run(() => addRemoteServer(label, url)),
    [run],
  );

  const remove = useCallback((id: string) => run(() => removeServer(id)), [run]);

  const start = useCallback((port?: number) => run(() => startLocalServer(port)), [run]);

  const stop = useCallback((id: string) => run(() => stopLocalServer(id)), [run]);

  return {
    available,
    state,
    busy,
    refreshing,
    error,
    reload,
    refresh,
    dismissError,
    activate,
    add,
    remove,
    start,
    stop,
  };
}
