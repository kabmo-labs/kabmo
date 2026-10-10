/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The fake SIDEBAR a plugin test drives.
 *
 * Split out of `fixtures.ts` because the fixtures file is at the size ceiling
 * and this is one cohesive half: the sessions the fake reports, the actions a
 * plugin took through it, and the two rules the real host follows —
 *
 * - a refusal is a VALUE (`false`) with the reason readable on `error`, never a
 *   throw, because that is what the host's routes answer; and
 * - the reason stays readable until a LATER attempt succeeds, so a plugin can
 *   render it after the call it belongs to has returned.
 *
 * `sidebarAction` and the two slots are the whole mechanism, and they exist as a
 * unit because getting either rule wrong is invisible: clearing the reason on
 * the way out makes it unreadable by the very caller the refusal was for, while
 * leaving the staging set makes every later attempt fail too.
 */

import type { SidebarThread, SidebarThreadActions } from '../slots-sidebar';

/** What a plugin may read of the sidebar in a test. */
export interface SidebarSnapshot {
  value: SidebarThread[];
  stale: boolean;
}

/** The sessions the fake reports, and the actions a plugin took. */
export interface FakeSidebarHandle {
  /** Replace the list and wake every `useSidebarThreads` reader. */
  setThreads(next: SidebarThread[]): void;
  /** Every action a plugin called, in order. */
  readonly calls: { action: string; args: unknown[] }[];
  /** The reason the NEXT mutation answers with. */
  failNext(reason: string): void;
}

/** The state one fake sidebar holds, and the parts the fixture wires up. */
export interface FakeSidebar {
  /** The service the kit reads. */
  readonly service: {
    sidebarThreads: () => SidebarSnapshot;
    subscribeSidebarThreads: (listener: (state: SidebarSnapshot) => void) => () => void;
    refreshSidebarThreads: () => void;
    sidebarActions: () => SidebarThreadActions;
  };
  /** The handle a test drives it with. */
  readonly control: FakeSidebarHandle;
}

/** Build one fake sidebar from the fixture's options. */
export function createFakeSidebar(options: { threads?: SidebarThread[]; stale?: boolean } = {}): FakeSidebar {
  let threads: SidebarThread[] = options.threads ?? [];
  let stale = options.stale ?? false;
  const listeners = new Set<(state: SidebarSnapshot) => void>();
  const calls: { action: string; args: unknown[] }[] = [];
  /** A reason the NEXT mutation refuses with, consumed by that attempt. */
  let stagedFailure: string | null = null;
  /** The reason the LAST refusal reported, readable until a later success. */
  let reason: string | null = null;

  const announce = () => {
    const snapshot: SidebarSnapshot = { value: threads, stale };
    for (const listener of [...listeners]) listener(snapshot);
  };

  /**
   * Record an action and answer it, honouring a staged failure.
   *
   * The STAGING is consumed by the attempt it refuses, while the REASON stays
   * readable until a later attempt succeeds — which is what the real host's
   * actions object does.
   */
  const action = (name: string, ...args: unknown[]): Promise<boolean> => {
    calls.push({ action: name, args });
    if (stagedFailure !== null) {
      reason = stagedFailure;
      stagedFailure = null;
      return Promise.resolve(false);
    }
    reason = null;
    return Promise.resolve(true);
  };

  return {
    service: {
      sidebarThreads: () => ({ value: threads, stale }),
      subscribeSidebarThreads: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      refreshSidebarThreads: () => announce(),
      sidebarActions: (): SidebarThreadActions => ({
        open: (sessionId) => {
          calls.push({ action: 'open', args: [sessionId] });
        },
        rename: (sessionId, title) => action('rename', sessionId, title),
        setArchived: (sessionId, archived) => action('setArchived', sessionId, archived),
        markSeen: (sessionId) => action('markSeen', sessionId),
        remove: (sessionId) => action('remove', sessionId),
        openNew: (openOptions) => {
          calls.push({ action: 'openNew', args: [openOptions] });
        },
        get error() {
          return reason;
        },
      }),
    },
    control: {
      setThreads: (next) => {
        threads = next;
        announce();
      },
      calls,
      failNext: (next) => {
        stagedFailure = next;
      },
    },
  };
}
