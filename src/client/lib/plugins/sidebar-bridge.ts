/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The sidebar, published to the plugin kit.
 *
 * bb calls this "threads"; the chamber calls the same thing SESSIONS. The read
 * is a PROJECTION of the host's own `sidebar` topic — the same realtime topic
 * the sidebar beside it reads — so a plugin cannot disagree with the list on
 * screen, including a run in flight.
 *
 * The writes go through the host's OWN routes. There is deliberately no second
 * session store: a plugin's `rename` posts what the sidebar's own inline editor
 * posts (`POST /api/sessions/:id/rename`), so the two cannot drift, and the
 * server's own refusal wording reaches the plugin.
 *
 * Process-wide, for the reason every other plugin bridge here is: under
 * `bun --hot` this module re-evaluates while a mounted subscriber still holds
 * the unsubscribe it was handed, and a module-level Set would come back empty.
 */

import type { SidebarThread, SidebarThreadActions } from '@ompchamber/plugin-sdk';
import { realtimeClient } from '@/shared/lib/realtime/client';
import { TOPIC_SIDEBAR, TOPIC_SIDEBAR_STATUS } from '@/shared/lib/realtime/protocol';
import { pluginContext } from '@/client/lib/plugins/context';
import { publishClientSignal } from '@/client/lib/signals';
import type { SidebarPayload, SidebarStatusPayload } from '@/shared/types/realtime';
import type { WorkspaceFolderData } from '@/shared/types';

/** What a subscriber is handed on every push. */
export interface SidebarThreadsSnapshot {
  value: SidebarThread[];
  stale: boolean;
}

type Listener = (state: SidebarThreadsSnapshot) => void;

interface SidebarSlot {
  listeners: Set<Listener>;
  unsubscribe: (() => void) | null;
}

declare global {
  // eslint-disable-next-line no-var
  var __ompChamberSidebarBridge: SidebarSlot | undefined;
}

function slot(): SidebarSlot {
  return (globalThis.__ompChamberSidebarBridge ??= { listeners: new Set(), unsubscribe: null });
}

/**
 * Flatten the sidebar's folders into the row list a plugin reads.
 *
 * The volatile status map is merged in here rather than by each consumer: the
 * sidebar splits `streamStatus`/`awaitingInput`/`runModel` into their own topic
 * because they change on every write while the structure needs a scan, and a
 * plugin should not have to know that.
 */
function projectThreads(): SidebarThread[] {
  const structure = realtimeClient.read<SidebarPayload>(TOPIC_SIDEBAR);
  const status = realtimeClient.read<SidebarStatusPayload>(TOPIC_SIDEBAR_STATUS);
  const folders: WorkspaceFolderData[] = structure?.folders ?? [];
  const threads: SidebarThread[] = [];
  for (const folder of folders) {
    for (const session of folder.sessions ?? []) {
      const volatile = status?.[String(session.id)];
      threads.push({
        id: String(session.id),
        folderId: String(folder.id),
        title: session.title,
        ...(session.updated_at ? { updatedAt: session.updated_at } : {}),
        ...(volatile?.streamStatus === 'stream' ? { isRunning: true } : {}),
        ...(volatile?.awaitingInput ? { awaitingInput: true } : {}),
        ...(session.is_archived === 1 ? { isArchived: true } : {}),
      });
    }
  }
  return threads;
}

/** The sidebar as it stands. */
export function sidebarThreads(): SidebarThreadsSnapshot {
  return {
    value: projectThreads(),
    stale: realtimeClient.isStale(TOPIC_SIDEBAR) || realtimeClient.isStale(TOPIC_SIDEBAR_STATUS),
  };
}

/**
 * Subscribe to sidebar changes.
 *
 * Both topics are subscribed on the FIRST listener and released on the last, so
 * a plugin that never reads the sidebar costs no frames — and a plugin that
 * does read it rides the same socket the sidebar already holds rather than
 * opening a second subscription per component.
 */
export function subscribeSidebarThreads(listener: Listener): () => void {
  const host = slot();
  host.listeners.add(listener);
  if (host.listeners.size === 1) {
    const notify = () => {
      const next = sidebarThreads();
      for (const each of host.listeners) each(next);
    };
    const offStructure = realtimeClient.subscribe(TOPIC_SIDEBAR, notify);
    const offStatus = realtimeClient.subscribe(TOPIC_SIDEBAR_STATUS, notify);
    host.unsubscribe = () => {
      offStructure();
      offStatus();
    };
  }
  return () => {
    host.listeners.delete(listener);
    if (host.listeners.size === 0) {
      host.unsubscribe?.();
      host.unsubscribe = null;
    }
  };
}

/** Test seam: drop every listener and the subscription they hold. */
export function resetSidebarBridge(): void {
  const host = slot();
  host.unsubscribe?.();
  host.unsubscribe = null;
  host.listeners.clear();
}

/** Ask the server for a fresh sidebar snapshot. */
export function refreshSidebarThreads(): void {
  realtimeClient.refresh(TOPIC_SIDEBAR);
  realtimeClient.refresh(TOPIC_SIDEBAR_STATUS);
}

/**
 * Select a session, as clicking its row does.
 *
 * The app's only routing state is `?sessionId=`, written through the same
 * `pushState` the sidebar uses — a plugin that set the URL itself would bypass
 * the module store every mounted component reads, and the sidebar would keep
 * showing the previous selection.
 */
function openSession(sessionId: string): void {
  const url = new URL(window.location.href);
  url.searchParams.set('sessionId', sessionId);
  window.history.pushState(null, '', url);
  // `pushState` does not fire `popstate`, so the search-param store has to be
  // told; otherwise only a reload would show the new selection. A plain Event
  // is enough — the store re-reads `location.search`, which pushState already
  // moved — and it avoids depending on a constructor some environments lack.
  window.dispatchEvent(new Event('popstate'));
}

/** POST one session mutation, answering whether the server accepted it. */
async function postSession(sessionId: string, suffix: string, body?: FormData): Promise<boolean> {
  try {
    const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}${suffix}`, {
      method: 'POST',
      ...(body ? { body } : {}),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** The session actions, as the kit reads them. */
export function sidebarActions(): SidebarThreadActions {
  return {
    open: openSession,
    rename: async (sessionId, title) => {
      const body = new FormData();
      body.set('name', title);
      const ok = await postSession(sessionId, '/rename', body);
      // The same signal the sidebar's own rename publishes, so the navbar and
      // the list follow a plugin's rename without a refetch.
      if (ok) publishClientSignal('session-renamed', { sessionId, title });
      return ok;
    },
    setArchived: async (sessionId, archived) => {
      const body = new FormData();
      body.set('archived', String(archived));
      return postSession(sessionId, '/archive', body);
    },
    markSeen: (sessionId) => postSession(sessionId, '/stream-seen'),
    remove: async (sessionId) => {
      try {
        const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' });
        return res.ok;
      } catch {
        return false;
      }
    },
    openNew: (options) => {
      const url = new URL(window.location.href);
      url.searchParams.set('sessionId', `new-${Date.now()}`);
      if (options?.folderId) url.searchParams.set('folderId', options.folderId);
      else url.searchParams.delete('folderId');
      window.history.pushState(null, '', url);
      window.dispatchEvent(new Event('popstate'));
    },
    get error() {
      // The refusals travel as `false` from each action, so there is no
      // separate reason to report here; the kit's own `error` state carries
      // what a THROW produced. Reading the current session keeps this honest
      // about which conversation a caller is looking at.
      void pluginContext();
      return null;
    },
  };
}
