/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The server list the desktop shell owns, as the navbar reads it.
 *
 * One store per window, not per component: the navbar button, its popover and
 * anything else that asks "which server am I on" must not each hold a copy —
 * two copies is how a start on one side leaves the other showing `Stopped`.
 *
 * Every mutation answers with the WHOLE state (`ServersState`), and the shell is
 * the source of truth: it re-reads its own list, re-probes every URL and
 * re-discovers local instances before answering. Adopting the response verbatim
 * is what keeps the panel from inventing a running state the shell does not
 * agree with.
 */

import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import {
  activateServer,
  addRemoteServer,
  bridgeError,
  isDesktopShell,
  readServers,
  removeServer,
  startLocalServer,
  stopLocalServer,
  type DesktopServersState,
} from '@/client/lib/desktop/bridge';

export interface DesktopServersStore {
  available: boolean;
  state: DesktopServersState | null;
  /** A request is in flight; the panel disables its controls rather than queueing. */
  busy: boolean;
  error: string | null;
  reload: () => Promise<void>;
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

export function useDesktopServers(open: boolean): DesktopServersStore {
  const available = isDesktopShell();
  const [state, setState] = useState<DesktopServersState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A mutation and a poll can overlap; the poll must not overwrite the answer
  // the user's own click produced. The counter is what tells them apart.
  const mutationsRef = useRef(0);

  const reload = useCallback(async () => {
    if (!available) return;
    const ticket = mutationsRef.current;
    try {
      const next = await readServers();
      if (mutationsRef.current === ticket) setState(next);
    } catch (err) {
      if (mutationsRef.current === ticket) setError(bridgeError(err));
    }
  }, [available]);

  const run = useCallback(
    async (action: () => Promise<DesktopServersState>) => {
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

  return { available, state, busy, error, reload, activate, add, remove, start, stop };
}
