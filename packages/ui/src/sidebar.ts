/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The sidebar hooks: what lets a plugin read the session list and act on a
 * session.
 *
 * bb calls this "threads"; the chamber calls the same thing sessions. One
 * concept under two names, and these hooks use the chamber's word because that
 * is what the host's own routes and types say.
 *
 * **EXPERIMENTAL.** The `experimental_` prefix is the marker bb uses for the
 * same two hooks, and it means the shape may move between minor versions — a
 * plugin that uses them opts into that. The stable participants (`useRpc`,
 * `useRealtime`, `useComposer`) carry no prefix.
 *
 * Both go through `requireServices()`, so a plugin outside the app throws naming
 * the real problem, and a host built before this seam answers an honest empty
 * state rather than a broken one — the same rule `useRealtime` follows for an
 * older host that cannot publish a topic.
 */

import { useCallback, useEffect, useState } from 'preact/hooks';
import { requireServices } from './services';
import type { SidebarThread, SidebarThreadActions, SidebarThreadsState } from '@kabmo-labs/plugin-sdk';

/**
 * The sessions the sidebar is showing.
 *
 * `stale` is surfaced rather than hidden, for the reason `useRealtime` gives: a
 * list shown as current when the socket is down is worse than one that says so.
 */
export function experimental_useSidebarThreads(): SidebarThreadsState {
  const [state, setState] = useState<{ value: SidebarThread[]; stale: boolean }>(() => ({
    value: [],
    stale: false,
  }));
  /** True until the host has answered once, so a view can hold its placeholder. */
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const services = requireServices();
    if (!services.subscribeSidebarThreads) {
      // An older host cannot supply this. Reporting "loaded, empty" is the
      // honest answer: there is nothing to wait for.
      setIsLoading(false);
      return;
    }
    // Seed from the host's current value BEFORE subscribing, so a component
    // that mounted between two pushes does not render empty until the next one.
    const seeded = services.sidebarThreads?.();
    if (seeded) {
      setState(seeded);
      setIsLoading(false);
    }
    return services.subscribeSidebarThreads((next) => {
      setState(next);
      setIsLoading(false);
    });
  }, []);

  const refresh = useCallback(() => {
    requireServices().refreshSidebarThreads?.();
  }, []);

  return { threads: state.value, isLoading, stale: state.stale, refresh };
}

/**
 * The session actions.
 *
 * The host owns the writes, so this is a thin pass-through — but the pass-through
 * is the point: a plugin gets the SAME routes the sidebar's own controls call,
 * with the server's own refusal wording, rather than a second implementation
 * that would drift.
 */
export function experimental_useSidebarThreadActions(): SidebarThreadActions {
  const [error, setError] = useState<string | null>(null);

  const actions = requireServices().sidebarActions?.();

  /**
   * Run one mutation, capturing a refusal's reason.
   *
   * TWO sources, because the host reports a refusal two ways and both are real:
   * a `false` answer is the host saying no (its routes answer the refusal as a
   * value), and the reason for it is on the actions object the host injected —
   * while a THROW is a transport or programming failure with no host wording.
   * Reading only the throw is what made a refused rename look like a silent
   * no-op; reading only the false would lose the reason.
   *
   * The error clears on the next attempt, so a stale reason does not sit over a
   * success.
   */
  const run = useCallback(
    async (operation: () => Promise<boolean>): Promise<boolean> => {
      setError(null);
      try {
        const ok = await operation();
        // A refusal carries its reason on the host's actions object, which is
        // where the route's own wording lands.
        if (!ok) setError(actions?.error ?? null);
        return ok;
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
        return false;
      }
    },
    [actions],
  );

  return {
    open: useCallback((sessionId: string) => actions?.open(sessionId), [actions]),
    rename: useCallback(
      (sessionId: string, title: string) => run(() => actions?.rename(sessionId, title) ?? Promise.resolve(false)),
      [actions, run],
    ),
    setArchived: useCallback(
      (sessionId: string, archived: boolean) =>
        run(() => actions?.setArchived(sessionId, archived) ?? Promise.resolve(false)),
      [actions, run],
    ),
    markSeen: useCallback(
      (sessionId: string) => run(() => actions?.markSeen(sessionId) ?? Promise.resolve(false)),
      [actions, run],
    ),
    remove: useCallback(
      (sessionId: string) => run(() => actions?.remove(sessionId) ?? Promise.resolve(false)),
      [actions, run],
    ),
    openNew: useCallback((options?: { folderId?: string }) => actions?.openNew(options), [actions]),
    error,
  };
}
